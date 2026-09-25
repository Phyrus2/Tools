import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import Swal from 'sweetalert2';
import {
  HotelLinkProduct,
  HotelLinkSupplier,
  HotelImportResult,
  HotelImportRow,
  HotelOption,
  HotelOptionInput,
  HotelOptionRevision,
  HotelOptionsService,
} from '../services/hotel-options';

@Component({
  selector: 'app-hotel-options',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './hotel-options.html',
  styleUrl: './hotel-options.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HotelOptions implements OnInit {
  options: HotelOption[] = [];
  year = 2026;
  availableYears = [2026, 2027];
  destinationGroups: { region: string; locations: { name: string; options: HotelOption[] }[] }[] =
    [];
  filterOptions: { region: string; location: string }[] = [];
  region = '';
  location = '';
  status = '';
  file: File | null = null;
  busy = false;
  listLoading = false;
  linkSaving = false;
  page = 1;
  readonly pageSize = 50;
  total = 0;
  message = '';
  error = '';
  linkItem: HotelOption | null = null;
  supplierQuery = '';
  productQuery = '';
  supplierResults: HotelLinkSupplier[] = [];
  productResults: HotelLinkProduct[] = [];
  supplierSearchLoading = false;
  productSearchLoading = false;
  selectedSupplier: HotelLinkSupplier | null = null;
  selectedProduct: HotelLinkProduct | null = null;
  historyItem: HotelOption | null = null;
  revisions: HotelOptionRevision[] = [];
  importResult: HotelImportResult | null = null;
  importSection: 'NEW' | 'UPDATED' | 'UNCHANGED' | 'SKIPPED' | null = null;
  importPage = 1;
  readonly importPageSize = 25;
  editItem: HotelOption | null = null;
  optionForm: HotelOptionInput | null = null;
  optionSaving = false;
  private supplierSearchRequestId = 0;
  private productSearchRequestId = 0;
  constructor(
    private api: HotelOptionsService,
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute,
    private router: Router,
  ) {}
  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const routeYear = Number.parseInt(params.get('year') || '2026', 10);
      if (!Number.isInteger(routeYear) || routeYear < 2000 || routeYear > 2100) {
        this.router.navigate(['/hotel-options', 2026], { replaceUrl: true });
        return;
      }
      this.year = routeYear;
      this.region = '';
      this.location = '';
      this.page = 1;
      this.file = null;
      this.importResult = null;
      this.importSection = null;
      this.load();
    });
  }
  get regions(): string[] {
    return [...new Set(this.filterOptions.map((x) => x.region).filter(Boolean))].sort();
  }
  get locations(): string[] {
    return [
      ...new Set(
        this.filterOptions
          .filter((x) => !this.region || x.region === this.region)
          .map((x) => x.location)
          .filter(Boolean),
      ),
    ].sort();
  }
  private groupDestinations(
    options: HotelOption[],
  ): { region: string; locations: { name: string; options: HotelOption[] }[] }[] {
    const regions = new Map<string, Map<string, HotelOption[]>>();
    for (const option of options) {
      if (!regions.has(option.region)) regions.set(option.region, new Map());
      const locations = regions.get(option.region)!;
      if (!locations.has(option.location)) locations.set(option.location, []);
      locations.get(option.location)!.push(option);
    }
    return [...regions.entries()].map(([region, locations]) => ({
      region,
      locations: [...locations.entries()].map(([name, options]) => ({ name, options })),
    }));
  }
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }
  load(resetPage = false): void {
    if (resetPage) this.page = 1;
    this.listLoading = true;
    this.api
      .list(
        { year: this.year, region: this.region, location: this.location, status: this.status },
        this.page,
        this.pageSize,
      )
      .pipe(
        finalize(() => {
          this.listLoading = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (r) => {
          this.options = r.options;
          this.destinationGroups = this.groupDestinations(r.options);
          this.total = r.total;
          this.availableYears = [...new Set([2026, 2027, ...r.available_years])].sort();
          this.filterOptions = r.filter_options;
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = 'Failed to load hotel options.';
          this.cdr.markForCheck();
        },
      });
  }
  changePage(page: number): void {
    const next = Math.min(Math.max(1, page), this.totalPages);
    if (next === this.page) return;
    this.page = next;
    this.load();
  }
  selectFile(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] || null;
  }
  import(): void {
    if (!this.file) return;
    this.busy = true;
    this.error = '';
    this.api
      .import(this.file, this.year)
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (r) => {
          this.importResult = r;
          this.importSection = null;
          this.message = `Import completed: ${r.summary.inserted} new, ${r.summary.updated} updated, ${r.summary.unchanged} unchanged, ${r.summary.skipped} skipped.`;
          this.load();
        },
        error: (e) => {
          this.error = e.error?.message || 'Import failed.';
        },
      });
  }
  get activeImportRows(): HotelImportRow[] {
    if (!this.importResult) return [];
    if (this.importSection === 'NEW') return this.importResult.newRows;
    if (this.importSection === 'UPDATED') return this.importResult.updatedRows;
    if (this.importSection === 'UNCHANGED') return this.importResult.unchangedRows;
    return this.importResult.skippedRows;
  }
  get activeImportPageRows(): HotelImportRow[] {
    const start = (this.importPage - 1) * this.importPageSize;
    return this.activeImportRows.slice(start, start + this.importPageSize);
  }
  get importTotalPages(): number {
    return Math.max(1, Math.ceil(this.activeImportRows.length / this.importPageSize));
  }
  get importPageStart(): number {
    return this.activeImportRows.length ? (this.importPage - 1) * this.importPageSize + 1 : 0;
  }
  get importPageEnd(): number {
    return Math.min(this.importPage * this.importPageSize, this.activeImportRows.length);
  }
  openImportSection(section: 'NEW' | 'UPDATED' | 'UNCHANGED' | 'SKIPPED'): void {
    this.importSection = section;
    this.importPage = 1;
  }
  assign(item: HotelOption): void {
    this.linkItem = item;
    this.supplierQuery = item.company_name || item.hotel_name;
    this.productQuery = item.product_name || item.room_type || '';
    this.selectedSupplier = item.supplier_id
      ? {
          supplier_id: item.supplier_id,
          company_name: item.company_name || item.hotel_name,
          location: null,
          region: null,
        }
      : null;
    this.selectedProduct = item.product_id
      ? {
          product_id: item.product_id,
          supplier_id: item.supplier_id!,
          name: item.product_name || item.room_type || '',
          type: null,
        }
      : null;
    this.searchSuppliers();
    if (this.selectedSupplier) this.searchProducts();
    this.cdr.markForCheck();
  }
  closeLink(): void {
    if (this.linkSaving) return;
    this.linkItem = null;
    this.supplierResults = [];
    this.productResults = [];
    this.cdr.markForCheck();
  }
  searchSuppliers(): void {
    const requestId = ++this.supplierSearchRequestId;
    if (this.supplierQuery.trim().length < 2) {
      this.supplierResults = [];
      this.supplierSearchLoading = false;
      this.cdr.markForCheck();
      return;
    }
    this.supplierSearchLoading = true;
    this.api
      .searchLinks(this.supplierQuery)
      .pipe(
        finalize(() => {
          if (requestId === this.supplierSearchRequestId) {
            this.supplierSearchLoading = false;
            this.cdr.markForCheck();
          }
        }),
      )
      .subscribe({
      next: (r) => {
        if (requestId !== this.supplierSearchRequestId) return;
        this.supplierResults = r.suppliers;
        this.cdr.markForCheck();
      },
      error: () => undefined,
      });
  }
  chooseSupplier(supplier: HotelLinkSupplier): void {
    this.selectedSupplier = supplier;
    this.selectedProduct = null;
    this.productQuery = this.optionForm?.room_type || this.linkItem?.room_type || '';
    this.searchProducts();
  }
  clearSelectedLink(): void {
    this.productSearchRequestId += 1;
    this.selectedSupplier = null;
    this.selectedProduct = null;
    this.productResults = [];
    this.productQuery = this.optionForm?.room_type || '';
    this.cdr.markForCheck();
  }
  searchProducts(): void {
    const requestId = ++this.productSearchRequestId;
    if (!this.selectedSupplier) {
      this.productResults = [];
      this.productSearchLoading = false;
      this.cdr.markForCheck();
      return;
    }
    this.productSearchLoading = true;
    this.api
      .searchLinks(this.productQuery, this.selectedSupplier.supplier_id)
      .pipe(
        finalize(() => {
          if (requestId === this.productSearchRequestId) {
            this.productSearchLoading = false;
            this.cdr.markForCheck();
          }
        }),
      )
      .subscribe({
      next: (r) => {
        if (requestId !== this.productSearchRequestId) return;
        this.productResults = r.products;
        this.cdr.markForCheck();
      },
      error: () => undefined,
      });
  }
  saveLink(): void {
    if (this.linkSaving || !this.linkItem || !this.selectedSupplier || !this.selectedProduct)
      return;
    const item = this.linkItem;
    this.linkSaving = true;
    this.error = '';
    this.api
      .assign(item.id, this.selectedSupplier.supplier_id, this.selectedProduct.product_id)
      .pipe(
        timeout(20000),
        finalize(() => {
          this.linkSaving = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (r) => {
          this.message = `${item.hotel_name} is now linked to ${r.supplier.company_name} / ${r.product.name}.`;
          this.linkSaving = false;
          this.closeLink();
          this.load();
        },
        error: (e) => {
          this.error =
            e.name === 'TimeoutError'
              ? 'Saving the Jambix link took too long. Please try again.'
              : e.error?.message || 'Failed to assign supplier.';
        },
      });
  }
  optionLabel(item: HotelOption, index: number): string {
    return item.option_code || ['A', 'B', 'C'][index] || '?';
  }
  addOption(region: string, location: string, options: HotelOption[]): void {
    const used = new Set(options.map((option) => option.option_code).filter(Boolean));
    const code = (['A', 'B', 'C'] as const).find((value) => !used.has(value)) || 'A';
    this.editItem = null;
    this.optionForm = {
      option_year: this.year,
      option_code: code,
      region,
      location,
      segment: location.includes('/') ? location.split('/').slice(1).join('/').trim() : null,
      hotel_name: '',
      room_type: '',
      supplier_id: null,
      product_id: null,
    };
    this.selectedSupplier = null;
    this.selectedProduct = null;
    this.prepareFormLinkSearch();
    this.cdr.markForCheck();
  }
  editOption(item: HotelOption): void {
    this.editItem = item;
    this.optionForm = {
      option_year: item.option_year,
      option_code: item.option_code || 'A',
      region: item.region,
      location: item.location,
      segment: item.segment,
      hotel_name: item.hotel_name,
      room_type: item.room_type || '',
      supplier_id: item.supplier_id,
      product_id: item.product_id,
    };
    this.selectedSupplier = item.supplier_id
      ? {
          supplier_id: item.supplier_id,
          company_name: item.company_name || item.hotel_name,
          location: item.location,
          region: item.region,
        }
      : null;
    this.selectedProduct = item.product_id
      ? {
          product_id: item.product_id,
          supplier_id: item.supplier_id!,
          name: item.product_name || item.room_type || '',
          type: null,
        }
      : null;
    this.prepareFormLinkSearch();
    this.cdr.markForCheck();
  }
  private prepareFormLinkSearch(): void {
    this.supplierQuery = this.selectedSupplier?.company_name || this.optionForm?.hotel_name || '';
    this.productQuery = this.selectedProduct?.name || this.optionForm?.room_type || '';
    this.supplierResults = [];
    this.productResults = [];
    if (this.supplierQuery) this.searchSuppliers();
    if (this.selectedSupplier) this.searchProducts();
  }
  closeOptionForm(): void {
    if (this.optionSaving) return;
    this.supplierSearchRequestId += 1;
    this.productSearchRequestId += 1;
    this.supplierSearchLoading = false;
    this.productSearchLoading = false;
    this.editItem = null;
    this.optionForm = null;
    this.selectedSupplier = null;
    this.selectedProduct = null;
    this.supplierResults = [];
    this.productResults = [];
    this.cdr.markForCheck();
  }
  saveOption(): void {
    if (!this.optionForm || this.optionSaving) return;
    this.optionForm.supplier_id = this.selectedSupplier?.supplier_id || null;
    this.optionForm.product_id = this.selectedProduct?.product_id || null;
    this.optionSaving = true;
    this.error = '';
    const request = this.editItem
      ? this.api.update(this.editItem.id, this.optionForm)
      : this.api.create(this.optionForm);
    request
      .pipe(
        finalize(() => {
          this.optionSaving = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (response) => {
          this.message = response.message;
          this.optionSaving = false;
          this.closeOptionForm();
          this.load();
        },
        error: (error) => {
          this.error = error.error?.message || 'Failed to save hotel option.';
        },
      });
  }
  async deleteOption(item: HotelOption): Promise<void> {
    const confirmation = await Swal.fire({
      title: `Delete Option ${item.option_code || ''}?`,
      html: `<strong>${this.escapeHtml(item.hotel_name)}</strong><br><span>This action cannot be undone.</span>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#b34f35',
      cancelButtonColor: '#66746c',
      reverseButtons: true,
      focusCancel: true,
    });
    if (!confirmation.isConfirmed) return;
    this.error = '';
    this.api.delete(item.id).subscribe({
      next: (response) => {
        this.message = response.message;
        void Swal.fire({
          title: 'Deleted',
          text: `${item.hotel_name} was removed from the hotel options.`,
          icon: 'success',
          confirmButtonColor: '#31584d',
          timer: 1800,
          timerProgressBar: true,
        });
        this.load();
      },
      error: (error) => {
        this.error = error.error?.message || 'Failed to delete hotel option.';
        void Swal.fire({
          title: 'Delete failed',
          text: this.error,
          icon: 'error',
          confirmButtonColor: '#31584d',
        });
        this.cdr.markForCheck();
      },
    });
  }
  private escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, (character) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      };
      return entities[character];
    });
  }
  trackByOptionId(_index: number, item: HotelOption): number {
    return item.id;
  }
  trackByImportRow(_index: number, row: HotelImportRow): string {
    return `${row.sheet_name || row.region}:${row.row_number || row.source_row}:${row.hotel_name}`;
  }
  showHistory(item: HotelOption): void {
    this.historyItem = item;
    this.api.history(item.id).subscribe({
      next: (r) => {
        this.revisions = r.history;
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.error = e.error?.message || 'Failed to load update history.';
      },
    });
  }
  changeLabels(revision: HotelOptionRevision): string[] {
    return Object.entries(revision.changes || {}).map(
      ([field, value]) =>
        `${field.replaceAll('_', ' ')}: ${value.from ?? '—'} → ${value.to ?? '—'}`,
    );
  }
  money(value: number | null): string {
    return value === null
      ? '—'
      : new Intl.NumberFormat('id-ID', {
          style: 'currency',
          currency: 'IDR',
          maximumFractionDigits: 0,
        }).format(value);
  }
}
