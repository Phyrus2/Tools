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
  HotelOptionRoom,
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
  linkRoom: HotelOptionRoom | null = null;
  supplierQuery = '';
  productQuery = '';
  supplierResults: HotelLinkSupplier[] = [];
  productResults: HotelLinkProduct[] = [];
  supplierSearchLoading = false;
  productSearchLoading = false;
  selectedSupplier: HotelLinkSupplier | null = null;
  selectedProduct: HotelLinkProduct | null = null;
  roomProductQueries: string[] = [];
  roomProductResults: HotelLinkProduct[][] = [];
  roomSelectedProducts: HotelLinkProduct[][] = [];
  roomProductLoading: boolean[] = [];
  historyItem: HotelOption | null = null;
  revisions: HotelOptionRevision[] = [];
  importResult: HotelImportResult | null = null;
  importSection: 'NEW' | 'UPDATED' | 'UNCHANGED' | 'SKIPPED' | null = null;
  importPage = 1;
  readonly importPageSize = 25;
  editItem: HotelOption | null = null;
  optionForm: HotelOptionInput | null = null;
  optionSaving = false;
  pendingQueueId: number | null = null;
  pendingSupplierId: number | null = null;
  pendingFileName = '';
  private supplierSearchRequestId = 0;
  private productSearchRequestId = 0;
  constructor(
    private api: HotelOptionsService,
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute,
    private router: Router,
  ) {}
  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const pendingId = Number.parseInt(params.get('pendingId') || '', 10);
      const pendingSupplierId = Number.parseInt(params.get('pendingSupplierId') || '', 10);
      this.pendingQueueId = Number.isInteger(pendingId) && pendingId > 0 ? pendingId : null;
      this.pendingSupplierId = Number.isInteger(pendingSupplierId) && pendingSupplierId > 0
        ? pendingSupplierId
        : null;
      this.pendingFileName = params.get('pendingFileName') || '';
      this.cdr.markForCheck();
    });
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
          if (this.pendingQueueId && this.pendingSupplierId) {
            this.api.completePending(this.pendingQueueId, this.pendingSupplierId).subscribe({
              next: (completed) => {
                this.message = `${this.message} ${completed.message}`;
                this.pendingQueueId = null;
                this.pendingSupplierId = null;
                this.pendingFileName = '';
                this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
                this.cdr.markForCheck();
              },
              error: (error) => {
                this.error = error.error?.message || 'Import succeeded, but the Pending Queue could not be completed.';
                this.cdr.markForCheck();
              },
            });
          }
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
  assign(item: HotelOption, room: HotelOptionRoom | null = null): void {
    this.linkItem = item;
    this.linkRoom = room || item.rooms?.[0] || null;
    this.supplierQuery = item.company_name || item.hotel_name;
    this.productQuery = this.linkRoom?.product_name || this.linkRoom?.room_type || item.room_type || '';
    this.selectedSupplier = item.supplier_id
      ? {
          supplier_id: item.supplier_id,
          company_name: item.company_name || item.hotel_name,
          location: null,
          region: null,
        }
      : null;
    const linkedProductId = this.linkRoom?.product_id || item.product_id;
    this.selectedProduct = linkedProductId
      ? {
          product_id: linkedProductId,
          supplier_id: item.supplier_id!,
          name: this.linkRoom?.product_name || item.product_name || this.linkRoom?.room_type || item.room_type || '',
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
    this.linkRoom = null;
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
    if (this.optionForm && this.selectedSupplier?.supplier_id !== supplier.supplier_id) {
      for (const room of this.optionForm.rooms) room.product_ids = [];
      this.roomSelectedProducts = this.optionForm.rooms.map(() => []);
    }
    this.selectedSupplier = supplier;
    this.selectedProduct = null;
    this.productQuery = this.linkRoom?.room_type || this.optionForm?.room_type || this.linkItem?.room_type || '';
    this.searchProducts();
    if (this.optionForm) {
      this.optionForm.rooms.forEach((_room, index) => this.searchRoomProducts(index));
    }
  }
  clearSelectedLink(): void {
    this.productSearchRequestId += 1;
    this.selectedSupplier = null;
    this.selectedProduct = null;
    this.productResults = [];
    if (this.optionForm) {
      for (const room of this.optionForm.rooms) room.product_ids = [];
      this.roomSelectedProducts = this.optionForm.rooms.map(() => []);
      this.roomProductResults = this.optionForm.rooms.map(() => []);
    }
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
      .assign(
        item.id,
        this.selectedSupplier.supplier_id,
        this.selectedProduct.product_id,
        this.linkRoom?.id,
      )
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
      rooms: [{ room_type: '', product_ids: [] }],
    };
    this.selectedSupplier = null;
    this.selectedProduct = null;
    this.roomSelectedProducts = [[]];
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
      rooms: item.rooms?.length
        ? item.rooms.map((room) => ({
            room_type: room.room_type,
            product_ids: room.products.map((product) => product.product_id),
          }))
        : [{ room_type: item.room_type || '', product_ids: item.product_id ? [item.product_id] : [] }],
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
    this.roomSelectedProducts = item.rooms?.length
      ? item.rooms.map((room) => [...room.products])
      : [this.selectedProduct ? [this.selectedProduct] : []];
    this.prepareFormLinkSearch();
    this.cdr.markForCheck();
  }
  private prepareFormLinkSearch(): void {
    this.supplierQuery = this.selectedSupplier?.company_name || this.optionForm?.hotel_name || '';
    this.productQuery = this.selectedProduct?.name || this.optionForm?.room_type || '';
    this.supplierResults = [];
    this.productResults = [];
    this.roomProductQueries = (this.optionForm?.rooms || []).map((room) => room.room_type);
    this.roomProductResults = (this.optionForm?.rooms || []).map(() => []);
    this.roomProductLoading = (this.optionForm?.rooms || []).map(() => false);
    if (this.supplierQuery) this.searchSuppliers();
    if (this.selectedSupplier) {
      this.searchProducts();
      this.roomProductQueries.forEach((_query, index) => this.searchRoomProducts(index));
    }
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
    this.roomProductQueries = [];
    this.roomProductResults = [];
    this.roomSelectedProducts = [];
    this.roomProductLoading = [];
    this.supplierResults = [];
    this.productResults = [];
    this.cdr.markForCheck();
  }
  saveOption(): void {
    if (!this.optionForm || this.optionSaving) return;
    this.optionForm.supplier_id = this.selectedSupplier?.supplier_id || null;
    this.optionForm.product_id = this.optionForm.rooms[0]?.product_ids[0] || null;
    this.optionForm.rooms = this.optionForm.rooms
      .map((room) => ({ ...room, room_type: room.room_type.trim() }))
      .filter((room) => room.room_type);
    if (this.optionForm.rooms.length) {
      this.optionForm.room_type = this.optionForm.rooms[0].room_type;
    }
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
        this.load();
      },
      error: (error) => {
        this.error = error.error?.message || 'Failed to delete hotel option.';
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
  trackByRoomId(index: number, room: HotelOptionRoom): number {
    return room.id || index;
  }
  optionNeedsLink(item: HotelOption): boolean {
    return !item.supplier_id || !item.rooms?.length || item.rooms.some((room) => !room.products.length);
  }
  linkedProductCount(item: HotelOption): number {
    return item.rooms.reduce((total, room) => total + room.products.length, 0);
  }
  addRoom(): void {
    if (!this.optionForm) return;
    this.optionForm.rooms.push({ room_type: '', product_ids: [] });
    this.roomProductQueries.push('');
    this.roomProductResults.push([]);
    this.roomSelectedProducts.push([]);
    this.roomProductLoading.push(false);
    this.cdr.markForCheck();
  }
  removeRoom(index: number): void {
    if (!this.optionForm || this.optionForm.rooms.length <= 1) return;
    this.optionForm.rooms.splice(index, 1);
    this.roomProductQueries.splice(index, 1);
    this.roomProductResults.splice(index, 1);
    this.roomSelectedProducts.splice(index, 1);
    this.roomProductLoading.splice(index, 1);
    this.optionForm.room_type = this.optionForm.rooms[0]?.room_type || '';
    this.cdr.markForCheck();
  }
  updateRoomName(index: number, value: string): void {
    if (this.optionForm && index === 0) this.optionForm.room_type = value;
    if (!this.roomProductQueries[index]) this.roomProductQueries[index] = value;
  }
  searchRoomProducts(index: number): void {
    if (!this.selectedSupplier || !this.optionForm?.rooms[index]) {
      this.roomProductResults[index] = [];
      return;
    }
    this.roomProductLoading[index] = true;
    this.api.searchLinks(
      this.roomProductQueries[index] || this.optionForm.rooms[index].room_type,
      this.selectedSupplier.supplier_id,
    ).pipe(finalize(() => {
      this.roomProductLoading[index] = false;
      this.cdr.markForCheck();
    })).subscribe({
      next: (response) => {
        this.roomProductResults[index] = response.products;
        this.cdr.markForCheck();
      },
      error: () => undefined,
    });
  }
  toggleRoomProduct(index: number, product: HotelLinkProduct): void {
    if (!this.optionForm?.rooms[index]) return;
    const room = this.optionForm.rooms[index];
    const selectedIndex = room.product_ids.indexOf(product.product_id);
    if (selectedIndex >= 0) {
      room.product_ids.splice(selectedIndex, 1);
      this.roomSelectedProducts[index] = (this.roomSelectedProducts[index] || [])
        .filter((item) => item.product_id !== product.product_id);
    } else {
      room.product_ids.push(product.product_id);
      this.roomSelectedProducts[index] = [...(this.roomSelectedProducts[index] || []), product];
    }
    this.cdr.markForCheck();
  }
  isRoomProductSelected(index: number, productId: number): boolean {
    return this.optionForm?.rooms[index]?.product_ids.includes(productId) || false;
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
