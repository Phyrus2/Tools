import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnInit,
} from '@angular/core';
import {
  BookedProduct,
  BookedProductImportResult,
  BookedProductImportStatus,
  ManualBookedProductPayload,
  SkippedBookedProduct,
} from '../../services/booked-product';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

class Paginator<T> {
  page = 1;
  pageSize = 50;
  private all: T[] = [];
 
  setData(items: T[]) {
    this.all = items ?? [];
    this.page = 1;
  }
 
  get total(): number {
    return this.all.length;
  }
 
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }
 
  get pageItems(): T[] {
    const start = (this.page - 1) * this.pageSize;
    return this.all.slice(start, start + this.pageSize);
  }
 
  goTo(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.page = page;
  }
 
  next() {
    this.goTo(this.page + 1);
  }
 
  prev() {
    this.goTo(this.page - 1);
  }

  prepend(item: T) {
    this.all = [item, ...this.all];
    this.page = 1;
  }

  remove(predicate: (item: T) => boolean) {
    this.all = this.all.filter((item) => !predicate(item));
    this.page = Math.min(this.page, this.totalPages);
  }
}

type SectionKey = 'new' | 'updated' | 'unchanged' | 'skipped' | null;

@Component({
  selector: 'app-booked-product-import',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './booked-product-import.html',
  styleUrl: './booked-product-import.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookedProductImport implements OnInit {
  selectedFile: File | null = null;
  loading = false;
  result: BookedProductImportResult | null = null;
  errorMessage = '';
  lastImport: BookedProductImportStatus | null = null;
  manualForm: ManualBookedProductPayload | null = null;
  manualSaving = false;
  manualError = '';
  manualNotice = '';

  // Which summary card's detail is currently open in the modal.
  activeSection: SectionKey = null;
 
  inserted =
    new Paginator<BookedProductImportResult['insertedRows'][number]>();
  updated =
    new Paginator<BookedProductImportResult['updatedRows'][number]>();
  unchanged =
    new Paginator<BookedProductImportResult['unchangedRows'][number]>();
  skipped =
    new Paginator<BookedProductImportResult['skippedRows'][number]>();
 
  constructor(
    private service: BookedProduct,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadImportStatus();
  }
 
  // ==========================================
  // FILE SELECT
  // ==========================================
 
  onFileSelected(event: any) {
    const file = event.target.files?.[0];
 
    if (!file) {
      return;
    }
 
    this.selectedFile = file;
    this.errorMessage = '';
    this.result = null;
    this.manualForm = null;
    this.manualNotice = '';
  }
 
  // ==========================================
  // IMPORT
  // ==========================================
 
  importBookedProduct() {
    this.errorMessage = '';
 
    if (!this.selectedFile) {
      this.errorMessage = 'Please select an Excel file.';
      return;
    }
 
    this.loading = true;
    this.cdr.markForCheck();
 
    this.service.importBookedProduct(this.selectedFile).subscribe({
      next: (response) => {
        this.loading = false;
        this.lastImport = response.lastImport;
        this.cdr.markForCheck();
 
        // Let the button repaint first, then assign the (possibly large)
        // result on the next tick so the UI doesn't look frozen while
        // Angular processes/paginates a large dataset.
        setTimeout(() => {
          this.result = response;
 
          this.inserted.setData(response.insertedRows);
          this.updated.setData(response.updatedRows);
          this.unchanged.setData(response.unchangedRows);
          this.skipped.setData(response.skippedRows);

          // A fresh import replaces whatever was open before.
          this.activeSection = null;
 
          this.cdr.markForCheck();
        }, 0);
      },
 
      error: (error) => {
        this.loading = false;
        this.errorMessage = error.error?.message || 'Import failed.';
        this.cdr.markForCheck();
      },
    });
  }

  private loadImportStatus(): void {
    this.service.getImportStatus().subscribe({
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
 
  // ==========================================
  // RESET
  // ==========================================
 
  reset() {
    this.selectedFile = null;
    this.result = null;
    this.errorMessage = '';
    this.activeSection = null;
    this.manualForm = null;
    this.manualError = '';
    this.manualNotice = '';
 
    this.inserted.setData([]);
    this.updated.setData([]);
    this.unchanged.setData([]);
    this.skipped.setData([]);
  }

  // ==========================================
  // DETAIL MODAL
  // ==========================================

  openSection(key: SectionKey): void {
    this.activeSection = key;
    this.cdr.markForCheck();
  }

  closeSection(): void {
    this.activeSection = null;
    this.cdr.markForCheck();
  }

  openManualProduct(row: SkippedBookedProduct): void {
    const data = row.manual_data;

    if (!data) {
      return;
    }

    const originalProductId = data.original_product_id;

    this.manualForm = {
      sourceRow: row.row,
      idMode: originalProductId && originalProductId > 0 ? 'manual' : 'random',
      productId: originalProductId && originalProductId > 0 ? originalProductId : null,
      supplierId: data.supplier_id,
      productName: data.product_name || '',
      productType: data.product_type || '',
      productStatus: 'One Time Product',
      booking: {
        bookedProductId: data.booked_product_id,
        dossierId: data.dossier_id || '',
        dossierName: data.dossier_name || '',
        status: data.booking_status || '',
        code: data.code || '',
        duration: data.duration,
        travelDate: data.travel_date || '',
        endDate: data.end_date || '',
        sales: data.sales || '',
        operational: data.operational || '',
        quantity: data.quantity,
        unit: data.unit || '',
        price: data.price,
        description: data.description || '',
        info: data.info || '',
        instructions: data.instructions || '',
        transportPickup: data.transport_pickup || '',
        transportDropoff: data.transport_dropoff || '',
      },
    };

    this.manualError = '';
    this.manualNotice = '';
    this.cdr.markForCheck();
  }

  closeManualProduct(): void {
    if (this.manualSaving) {
      return;
    }

    this.manualForm = null;
    this.manualError = '';
    this.cdr.markForCheck();
  }

  saveManualProduct(): void {
    if (!this.manualForm || this.manualSaving) {
      return;
    }

    this.manualSaving = true;
    this.manualError = '';

    this.service.createManualProduct(this.manualForm).subscribe({
      next: (response) => {
        const sourceRow = this.manualForm?.sourceRow;

        if (sourceRow !== undefined) {
          this.skipped.remove((row) => row.row === sourceRow);
        }

        this.inserted.prepend(response.bookedProduct);

        if (this.result) {
          this.result.skippedRows = this.result.skippedRows.filter(
            (row) => row.row !== sourceRow,
          );
          this.result.insertedRows = [
            response.bookedProduct,
            ...this.result.insertedRows,
          ];
          this.result.summary.skipped = this.skipped.total;
          this.result.summary.inserted = this.inserted.total;
        }

        this.manualSaving = false;
        this.manualForm = null;
        this.manualNotice = `${response.message} Product ID: ${response.productId}.`;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.manualSaving = false;
        this.manualError =
          error.error?.message || 'Gagal menambahkan produk secara manual.';
        this.cdr.markForCheck();
      },
    });
  }
 
  // ==========================================
  // DISPLAY VALUE
  // ==========================================
 
  displayValue(value: any): string {
    if (value === null || value === undefined || value === '') {
      return '-';
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
 
    return String(value);
  }

  formatChangeField(field: string): string {
    const labels: Record<string, string> = {
      dossier_id: 'Dossier ID',
      dossier_name: 'Dossier Name',
      supplier_id: 'Supplier ID',
      product_id: 'Product ID',
      product_name: 'Product Name',
      status: 'Status',
      code: 'Code',
      duration: 'Duration',
      travel_date: 'Travel Date',
      end_date: 'End Date',
      sales: 'Sales',
      operational: 'Operational',
      quantity: 'Quantity',
      unit: 'Unit',
      price: 'Price',
      description: 'Description',
      info: 'Info',
      instructions: 'Instructions',
      transport_pickup: 'Transport Pickup',
      transport_dropoff: 'Transport Dropoff',
    };

    return labels[field] ?? field;
  }

  displayChangeValue(field: string, value: any): string {
    if (field === 'travel_date' || field === 'end_date') {
      return this.formatDate(value);
    }

    return this.displayValue(value);
  }
 
  // ==========================================
  // FORMAT DATE
  // Backend mengirim travel_date/end_date dalam
  // format YYYY-MM-DD. Ditampilkan sebagai DD-MM-YYYY.
  // ==========================================
 
  formatDate(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }
 
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
 
    if (!match) {
      return String(value);
    }
 
    const [, year, month, day] = match;
 
    return `${day}-${month}-${year}`;
  }
 
  // ==========================================
  // TRACK BY
  // ==========================================
 
  trackByRow(_index: number, item: any): any {
    return item.id ?? item.row;
  }

  trackByField(_index: number, item: any): string {
    return item.field;
  }
}
