import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, firstValueFrom } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

import {
  Search,
  BookedProductSearchParams,
  BookedProductSearchResult,
} from '../../services/search';
import { BookedProduct, BookedProductImportStatus } from '../../services/booked-product';
import { DatePicker } from '../../shared/date-picker/date-picker';

type DateMode = 'none' | 'single' | 'from' | 'until' | 'range';
type ExportKind = 'pdf' | 'excel' | 'copy';

const PAGE_SIZE = 25;
const MIN_KEYWORD_LENGTH = 2;
const INDONESIAN_MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

// Limit maksimum per-request yang sudah diizinkan backend (lihat searchBookedProduct.js).
// Dipakai saat export supaya kita bisa menyapu semua halaman dengan request sesedikit mungkin.
const EXPORT_FETCH_LIMIT = 200;

interface ExportColumn {
  label: string;
  key: string;
}

// Kolom & urutan yang SAMA dipakai untuk export PDF, Excel, maupun Copy.
const EXPORT_COLUMNS: ExportColumn[] = [
  { label: 'Dossier ID', key: 'dossier_id' },
  { label: 'Dossier Name', key: 'dossier_name' },
  { label: 'Status', key: 'status' },
  { label: 'Supplier', key: 'company_name' },
  { label: 'Product', key: 'product_name' },
  { label: 'Duration', key: 'duration' },
  { label: 'Travel Date', key: 'travel_date' },
  { label: 'End Date', key: 'end_date' },
  { label: 'Sales', key: 'sales' },
  { label: 'Operational', key: 'operational' },
  { label: 'Quantity', key: 'quantity' },
];

@Component({
  selector: 'app-search-booked-product',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, DatePicker],
  templateUrl: './search-booked-product.html',
  styleUrl: './search-booked-product.scss',
})
export class SearchBookedProduct implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private bookedProductService = inject(Search);
  private bookedProductImportService = inject(BookedProduct);
  private cdr = inject(ChangeDetectorRef);

  form = this.fb.group({
    keyword: [''],
    dateMode: ['none' as DateMode],
    date: [''],
    startDate: [''],
    endDate: [''],
  });

  results: BookedProductSearchResult[] = [];
  page = 1;
  totalPages = 1;
  total = 0;

  loading = false;
  errorMessage: string | null = null;
  hasSearched = false;

  selectedItem: BookedProductSearchResult | null = null;
  lastImport: BookedProductImportStatus | null = null;

  // --- Export & copy state ---
  exporting: ExportKind | null = null;
  exportError: string | null = null;
  copyFeedback = false;
  private copyFeedbackTimeout?: ReturnType<typeof setTimeout>;

  // --- Per-row copy state (copy satu item langsung dari tabel) ---
  copiedRowIndex: number | null = null;
  private copiedRowTimeout?: ReturnType<typeof setTimeout>;

  private readonly search$ = new Subject<void>();
  private subscription?: Subscription;

  ngOnInit(): void {
    this.loadImportStatus();

    // Trigger pencarian otomatis saat user berhenti mengetik.
    this.subscription = this.form
      .get('keyword')!
      .valueChanges.pipe(debounceTime(400), distinctUntilChanged())
      .subscribe((keyword) => {
        console.log('🔍 Keyword:', keyword);

        this.page = 1;
        this.triggerSearch();
      });

    this.subscription.add(
      this.search$
        .pipe(
          tap(() => {
            console.log('🚀 Search triggered');

            this.loading = true;
            this.errorMessage = null;
            this.cdr.markForCheck();
          }),

          switchMap(() => {
            const params = this.buildParams();

            console.log('📤 Search Params:', params);

            if (!params) {
              console.log('⚠️ Params kosong / invalid');

              this.loading = false;
              this.cdr.markForCheck();
              return [];
            }

            return this.bookedProductService.searchBookedProduct(params);
          }),
        )
        .subscribe({
          next: (response) => {
            console.log('📥 API Response:', response);

            if (!response) {
              console.log('⚠️ Response kosong');
              this.loading = false;
              this.cdr.markForCheck();
              return;
            }

            console.log('📦 Results:', response.results);
            console.log('📄 Pagination:', response.pagination);

            this.loading = false;
            this.hasSearched = true;
            this.results = response.results;
            this.page = response.pagination.page;
            this.totalPages = response.pagination.totalPages;
            this.total = response.pagination.total;
            this.cdr.markForCheck();
          },

          error: (err) => {
            console.error('❌ API Error:', err);

            console.error('❌ Error Message:', err?.error?.message);

            this.loading = false;
            this.hasSearched = true;
            this.results = [];

            this.errorMessage = err?.error?.message || 'Gagal melakukan pencarian.';
            this.cdr.markForCheck();
          },
        }),
    );
  }

  openDetail(item: BookedProductSearchResult): void {
    this.selectedItem = item;
  }

  closeDetail(): void {
    this.selectedItem = null;
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    clearTimeout(this.copyFeedbackTimeout);
    clearTimeout(this.copiedRowTimeout);
  }

  formatLongText(text: string | null): string {
    if (!text) return '';

    // 1) ratakan semua whitespace (spasi ganda, newline, dsb) jadi satu spasi
    let formatted = text.replace(/\s+/g, ' ').trim();

    // 2) baris baru sebelum "DAY <angka>" (dengan/tanpa titik dua),
    //    kecuali kalau nempel langsung setelah kata "Itinerary"
    formatted = formatted.replace(/(?<!Itinerary\s)\s*(?=DAY\s*\d+\b)/gi, '\n\n');

    // 3) baris baru sebelum "Meals:"
    formatted = formatted.replace(/\s*(?=Meals\s*:)/gi, '\n');

    // 4) baris baru sebelum setiap item dash " - "
    formatted = formatted.replace(/\s+-\s+/g, '\n- ');

    // 5) rapikan spasi nyasar & batasi baris kosong berlebih
    formatted = formatted
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');

    return formatted.trim();
  }

  formatDisplayDate(value: string | null | undefined): string {
    if (!value) return '—';

    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!match) return String(value);

    const [, year, month, day] = match;
    return `${Number(day)} ${INDONESIAN_MONTH_NAMES[Number(month) - 1]} ${year}`;
  }

  formatDisplayDateTime(value: string | null | undefined): string {
    if (!value) return '—';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  // =====================================================
  // ACTIONS
  // =====================================================

  onSubmit(): void {
    this.page = 1;
    this.triggerSearch();
  }

  onDateModeChange(): void {
    this.form.patchValue({ date: '', startDate: '', endDate: '' });
    this.page = 1;
    this.triggerSearch();
  }

  onDateFieldChange(): void {
    this.page = 1;
    this.triggerSearch();
  }

  onSingleDateSelected(value: string): void {
    this.form.controls.date.setValue(value);
    this.onDateFieldChange();
  }

  onStartDateSelected(value: string): void {
    this.form.controls.startDate.setValue(value);
    this.onDateFieldChange();
  }

  onEndDateSelected(value: string): void {
    this.form.controls.endDate.setValue(value);
    this.onDateFieldChange();
  }

  get isDateRangeInvalid(): boolean {
    const { dateMode, startDate, endDate } = this.form.getRawValue();

    return Boolean(dateMode === 'range' && startDate && endDate && startDate > endDate);
  }

  goToPage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.totalPages || nextPage === this.page) {
      return;
    }
    this.page = nextPage;
    this.triggerSearch();
  }

  clearSearch(): void {
    this.form.reset({
      keyword: '',
      dateMode: 'none',
      date: '',
      startDate: '',
      endDate: '',
    });
    this.results = [];
    this.hasSearched = false;
    this.errorMessage = null;
    this.exportError = null;
    this.page = 1;
    this.totalPages = 1;
    this.total = 0;
  }

  matchedFieldLabel(field: string): string {
    const labels: Record<string, string> = {
      company_name: 'Nama Supplier',
      town: 'Kota',
      region: 'Wilayah',
      location: 'Lokasi',
      product_name: 'Nama Produk',
      description: 'Deskripsi',
      info: 'Info',
      instructions: 'Instruksi',
      travel_date: 'Tanggal',
      address: 'Alamat',
      other: 'Lainnya',
    };
    console.log('🔖 Matched Field:', field, '=>', labels[field] ?? field);
    return labels[field] ?? field;
  }

  // =====================================================
  // EXPORT & COPY
  // =====================================================
  // Catatan: export mengambil SEMUA baris yang cocok dengan filter pencarian
  // saat ini (bukan cuma halaman yang sedang tampil di layar), dengan menyapu
  // seluruh halaman lewat endpoint search yang sama.

  async exportPdf(): Promise<void> {
    if (this.exporting) return;

    const rows = await this.prepareExportRows('pdf');
    if (!rows) return;

    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;

      // Palet warna brand
      const COLOR_FOREST: [number, number, number] = [53, 86, 77]; // var(--bp-forest)
      const COLOR_CREAM: [number, number, number] = [247, 245, 240];
      const COLOR_TEXT: [number, number, number] = [40, 40, 40];
      const COLOR_MUTED: [number, number, number] = [120, 120, 120];
      const COLOR_BORDER: [number, number, number] = [225, 222, 214];

      const drawHeader = () => {
        // Bar hijau di bagian atas halaman
        doc.setFillColor(...COLOR_FOREST);
        doc.rect(0, 0, pageWidth, 58, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text(this.buildPdfTitle(), margin, 30);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(220, 230, 226);
        doc.text(`${rows.length} booking   •   Exported ${this.formatTimestamp()}`, margin, 46);
      };

      const drawFooter = (pageNumber: number, pageCount: number) => {
        doc.setDrawColor(...COLOR_BORDER);
        doc.setLineWidth(0.5);
        doc.line(margin, pageHeight - 30, pageWidth - margin, pageHeight - 30);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...COLOR_MUTED);
        doc.text('Booking Report', margin, pageHeight - 18);
        doc.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - margin, pageHeight - 18, {
          align: 'right',
        });
      };

      drawHeader();

      // Dihitung otomatis lewat callback didDrawPage di bawah — aman lintas versi jsPDF
      let totalPages = 1;

      autoTable(doc, {
        startY: 76,
        head: [EXPORT_COLUMNS.map((c) => c.label)],
        body: rows.map((row) => EXPORT_COLUMNS.map((c) => this.stringifyCell((row as any)[c.key]))),
        theme: 'grid',
        margin: { left: margin, right: margin, top: 76, bottom: 40 },
        styles: {
          font: 'helvetica',
          fontSize: 8.5,
          cellPadding: { top: 6, bottom: 6, left: 8, right: 8 },
          textColor: COLOR_TEXT,
          lineColor: COLOR_BORDER,
          lineWidth: 0.5,
          valign: 'middle',
        },
        headStyles: {
          fillColor: COLOR_FOREST,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8.5,
          halign: 'left',
        },
        alternateRowStyles: {
          fillColor: COLOR_CREAM,
        },
        // Rata kanan untuk kolom nominal/angka, rata tengah untuk status
        // — sesuaikan key ini dengan key asli di EXPORT_COLUMNS milikmu
        columnStyles: EXPORT_COLUMNS.reduce(
          (acc, c, i) => {
            if (['total', 'amount', 'price'].includes(c.key)) {
              acc[i] = { halign: 'right' };
            }
            if (c.key === 'status') {
              acc[i] = { halign: 'center' };
            }
            return acc;
          },
          {} as Record<number, any>,
        ),

        // Beri warna teks pada kolom status sesuai nilainya
        didParseCell: (data) => {
          if (data.section !== 'body') return;
          const columnKey = EXPORT_COLUMNS[data.column.index]?.key;
          if (columnKey !== 'status') return;

          const value = String(data.cell.raw ?? '').toLowerCase();
          const statusColors: Record<string, [number, number, number]> = {
            confirmed: [39, 116, 87],
            completed: [39, 116, 87],
            pending: [176, 132, 33],
            cancelled: [178, 58, 46],
            canceled: [178, 58, 46],
          };
          const match = Object.keys(statusColors).find((k) => value.includes(k));
          if (match) {
            data.cell.styles.textColor = statusColors[match];
            data.cell.styles.fontStyle = 'bold';
          }
        },

        // Ulangi header di setiap halaman baru + catat jumlah halaman berjalan
        didDrawPage: (data) => {
          totalPages = data.pageNumber;
          if (data.pageNumber > 1) {
            drawHeader();
          }
        },
      });

      // Tambahkan footer + nomor halaman ke semua halaman yang sudah dibuat
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        drawFooter(i, totalPages);
      }

      doc.save(this.buildExportFilename('pdf'));
    } catch (err) {
      console.error('❌ Export PDF error:', err);
      this.exportError = 'Gagal membuat file PDF.';
    } finally {
      this.exporting = null;
      this.cdr.markForCheck();
    }
  }

  async exportExcel(): Promise<void> {
    if (this.exporting) return;

    const rows = await this.prepareExportRows('excel');
    if (!rows) return;

    try {
      const sheetData = rows.map((row) => {
        const record: Record<string, unknown> = {};
        for (const col of EXPORT_COLUMNS) {
          record[col.label] = (row as any)[col.key] ?? '';
        }
        return record;
      });

      const worksheet = XLSX.utils.json_to_sheet(sheetData);
      worksheet['!cols'] = EXPORT_COLUMNS.map(() => ({ wch: 18 }));

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Booked Product');

      XLSX.writeFile(workbook, this.buildExportFilename('xlsx'));
    } catch (err) {
      console.error('❌ Export Excel error:', err);
      this.exportError = 'Gagal membuat file Excel.';
    } finally {
      this.exporting = null;
      this.cdr.markForCheck();
    }
  }

  async copyResults(): Promise<void> {
    if (this.exporting) return;

    const rows = await this.prepareExportRows('copy');
    if (!rows) return;

    try {
      const header: string[] = [`*Hasil Booked Product* (${rows.length} data)`];
      if (this.form.value.keyword) header.push(`Keyword: "${this.form.value.keyword}"`);
      header.push(`Diekspor ${this.formatTimestamp()}`);

      const blocks = rows.map((row, index) => this.buildWhatsAppBlock(row as any, index + 1));
      const text = [header.join('\n'), '', blocks.join('\n\n')].join('\n');

      await this.writeClipboard(text);

      this.copyFeedback = true;
      clearTimeout(this.copyFeedbackTimeout);
      this.copyFeedbackTimeout = setTimeout(() => {
        this.copyFeedback = false;
        this.cdr.markForCheck();
      }, 2000);
    } catch (err) {
      console.error('❌ Copy error:', err);
      this.exportError = 'Gagal menyalin data. Periksa izin clipboard browser lalu coba lagi.';
    } finally {
      this.exporting = null;
      this.cdr.markForCheck();
    }
  }

  /**
   * Copy satu baris langsung dari tabel hasil (tanpa perlu mengambil ulang
   * semua halaman) — dipakai oleh tombol copy per-item.
   */
  async copyItem(item: BookedProductSearchResult, rowIndex: number): Promise<void> {
    this.exportError = null;

    try {
      const text = this.buildWhatsAppBlock(item as any);
      await this.writeClipboard(text);

      this.copiedRowIndex = rowIndex;
      clearTimeout(this.copiedRowTimeout);
      this.copiedRowTimeout = setTimeout(() => {
        this.copiedRowIndex = null;
        this.cdr.markForCheck();
      }, 1500);
      this.cdr.markForCheck();
    } catch (err) {
      console.error('❌ Copy item error:', err);
      this.exportError = 'Gagal menyalin data. Periksa izin clipboard browser lalu coba lagi.';
      this.cdr.markForCheck();
    }
  }

  /**
   * Bikin satu blok teks rapi siap-tempel ke WhatsApp untuk satu record
   * (bukan tabel/TSV — WhatsApp tidak merender tabel, jadi TSV cuma jadi
   * berantakan). Field kosong otomatis disembunyikan.
   *
   * `index` diisi kalau blok ini bagian dari export banyak baris (ditampilkan
   * sebagai "1. *Nama*"); dikosongkan untuk copy satu item dari tabel
   * (tanpa nomor urut).
   */
  private buildWhatsAppBlock(row: any, index?: number): string {
    const dateRange = this.buildDateRangeText(
      this.formatDateForExport(row.travel_date),
      this.formatDateForExport(row.end_date),
    );
    const hasQty = row.quantity !== undefined && row.quantity !== null && row.quantity !== '';
    const title = this.stringifyCell(row.product_name) || 'Tanpa nama produk';

    const lines = [
      index ? `${index}. *${title}*` : `*${title}*`,
      row.dossier_name || row.dossier_id
        ? `Dossier: ${[row.dossier_name, row.dossier_id].filter(Boolean).join(' - ')}`
        : null,
      row.status ? `Status: ${row.status}` : null,
      row.company_name ? `Supplier: ${row.company_name}` : null,
      row.duration ? `Duration: ${row.duration}` : null,
      dateRange ? `Tanggal: ${dateRange}` : null,
      row.sales ? `Sales: ${row.sales}` : null,
      row.operational ? `Operational: ${row.operational}` : null,
      hasQty ? `Qty: ${row.quantity}` : null,
    ].filter((line): line is string => Boolean(line));

    return lines.join('\n');
  }

  private buildDateRangeText(travelDate: string, endDate: string): string {
    if (!travelDate && !endDate) return '';
    if (travelDate && endDate && travelDate !== endDate) return `${travelDate} - ${endDate}`;
    return travelDate || endDate;
  }

  /**
   * Ambil SEMUA baris yang cocok filter pencarian saat ini, lalu rapikan
   * field tanggal untuk ditampilkan di file export. Return null kalau tidak
   * ada yang bisa diekspor atau terjadi error saat mengambil data.
   */
  private async prepareExportRows(kind: ExportKind): Promise<BookedProductSearchResult[] | null> {
    this.exportError = null;

    if (!this.hasSearched || this.total === 0) {
      this.exportError = 'Tidak ada hasil untuk diekspor.';
      return null;
    }

    this.exporting = kind;
    this.cdr.markForCheck();

    try {
      const allRows = await this.fetchAllResults();
      return allRows.map((row) => ({
        ...row,
        travel_date: this.formatDateForExport((row as any).travel_date) as any,
        end_date: this.formatDateForExport((row as any).end_date) as any,
      }));
    } catch (err) {
      console.error('❌ Gagal mengambil semua data untuk export:', err);
      this.exportError = 'Gagal mengambil data dari server untuk diekspor.';
      this.exporting = null;
      this.cdr.markForCheck();
      return null;
    }
  }

  /**
   * Menyapu semua halaman lewat endpoint search yang sama (limit maksimum
   * server = 200/request), supaya export tidak terbatas hanya pada halaman
   * yang sedang aktif di UI.
   */
  private async fetchAllResults(): Promise<BookedProductSearchResult[]> {
    const baseParams = this.buildBaseParams();
    if (!baseParams) return [];

    let currentPage = 1;
    let totalPages = 1;
    const all: BookedProductSearchResult[] = [];

    do {
      const response = await firstValueFrom(
        this.bookedProductService.searchBookedProduct({
          ...baseParams,
          page: currentPage,
          limit: EXPORT_FETCH_LIMIT,
        } as BookedProductSearchParams),
      );

      if (!response) break;

      all.push(...response.results);
      totalPages = response.pagination.totalPages;
      currentPage++;
    } while (currentPage <= totalPages);

    return all;
  }

  private stringifyCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  }

  private async writeClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();

    const copied = document.execCommand('copy');
    textArea.remove();

    if (!copied) {
      throw new Error('Browser tidak mengizinkan akses clipboard.');
    }
  }

  private formatDateForExport(value: string | null | undefined): string {
    if (!value) return '';
    // Backend mengirim tanggal berformat YYYY-MM-DD (atau ISO datetime) — parse
    // manual (bukan `new Date()`) supaya tidak kena pergeseran timezone.
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (match) {
      const [, y, m, d] = match;
      return `${d}/${m}/${y}`;
    }
    return String(value);
  }

  private formatTimestamp(): string {
    const now = new Date();
    return `${this.pad2(now.getDate())}/${this.pad2(now.getMonth() + 1)}/${now.getFullYear()} ${this.pad2(now.getHours())}:${this.pad2(now.getMinutes())}`;
  }

  private buildPdfTitle(): string {
    const { dateMode, date, startDate, endDate } = this.form.getRawValue();
    const selectedDate = this.formatDateForTitle(date);
    const selectedStartDate = this.formatDateForTitle(startDate);
    const selectedEndDate = this.formatDateForTitle(endDate);

    if (dateMode === 'single' && selectedDate) {
      return `Booked Product - ${selectedDate}`;
    }

    if (dateMode === 'from' && selectedDate) {
      return `Booked Product - From ${selectedDate}`;
    }

    if (dateMode === 'until' && selectedDate) {
      return `Booked Product - Until ${selectedDate}`;
    }

    if (dateMode === 'range') {
      if (selectedStartDate && selectedEndDate) {
        return `Booked Product - ${selectedStartDate} to ${selectedEndDate}`;
      }

      if (selectedStartDate) {
        return `Booked Product - From ${selectedStartDate}`;
      }

      if (selectedEndDate) {
        return `Booked Product - Until ${selectedEndDate}`;
      }
    }

    return 'Booked Product - Search Results';
  }

  private formatDateForTitle(value: string | null | undefined): string {
    if (!value) return '';

    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!match) return String(value);

    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const [, year, month, day] = match;

    return `${monthNames[Number(month) - 1]} ${Number(day)}, ${year}`;
  }

  private buildExportFilename(ext: string): string {
    const now = new Date();
    const stamp = `${now.getFullYear()}${this.pad2(now.getMonth() + 1)}${this.pad2(now.getDate())}-${this.pad2(now.getHours())}${this.pad2(now.getMinutes())}`;
    return `booked-product-${stamp}.${ext}`;
  }

  private pad2(n: number): string {
    return String(n).padStart(2, '0');
  }

  // =====================================================
  // INTERNAL
  // =====================================================

  private triggerSearch(): void {
    const keyword = (this.form.value.keyword ?? '').trim();

    if (this.isDateRangeInvalid) {
      this.loading = false;
      this.results = [];
      this.hasSearched = false;
      this.errorMessage = null;
      this.total = 0;
      this.totalPages = 1;
      this.cdr.markForCheck();
      return;
    }

    if (
      (keyword.length > 0 && keyword.length < MIN_KEYWORD_LENGTH) ||
      (keyword.length === 0 && !this.hasDateFilter())
    ) {
      this.results = [];
      this.hasSearched = false;
      this.errorMessage = null;
      this.total = 0;
      this.totalPages = 1;
      this.cdr.markForCheck();
      return;
    }

    this.search$.next();
  }

  private loadImportStatus(): void {
    this.bookedProductImportService.getImportStatus().subscribe({
      next: (response) => {
        this.lastImport = response.lastImport;
        this.cdr.markForCheck();
      },
      error: () => {
        this.lastImport = null;
        this.cdr.markForCheck();
      },
    });
  }

  private buildParams(): BookedProductSearchParams | null {
    const base = this.buildBaseParams();
    if (!base) return null;

    return {
      ...base,
      page: this.page,
      limit: PAGE_SIZE,
    };
  }

  /**
   * Params pencarian tanpa page/limit — dipakai untuk pencarian normal
   * (dikombinasikan dengan halaman/limit UI) maupun untuk export (dikombinasikan
   * dengan loop semua halaman di fetchAllResults()).
   */
  private buildBaseParams(): Omit<BookedProductSearchParams, 'page' | 'limit'> | null {
    const value = this.form.value;
    const keyword = (value.keyword ?? '').trim();

    if (this.isDateRangeInvalid) {
      return null;
    }

    if (
      (keyword.length > 0 && keyword.length < MIN_KEYWORD_LENGTH) ||
      (keyword.length === 0 && !this.hasDateFilter())
    ) {
      return null;
    }

    const params: Omit<BookedProductSearchParams, 'page' | 'limit'> = { keyword };

    if (value.dateMode === 'single' && value.date) {
      params.date = value.date;
    } else if (value.dateMode === 'from' && value.date) {
      params.startDate = value.date;
    } else if (value.dateMode === 'until' && value.date) {
      params.endDate = value.date;
    } else if (value.dateMode === 'range') {
      if (value.startDate) params.startDate = value.startDate;
      if (value.endDate) params.endDate = value.endDate;
    }

    return params;
  }

  private hasDateFilter(): boolean {
    const { dateMode, date, startDate, endDate } = this.form.value;

    if (dateMode === 'single' || dateMode === 'from' || dateMode === 'until') {
      return Boolean(date);
    }

    return dateMode === 'range' && Boolean(startDate || endDate);
  }
}
