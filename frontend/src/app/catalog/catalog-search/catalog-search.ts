import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import {
  CatalogPagination,
  CatalogSearchResponse,
  CatalogSearchService,
  CatalogSearchType,
  ProductSearchResult,
  SupplierSearchResult,
} from '../../services/catalog-search';

@Component({
  selector: 'app-catalog-search',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './catalog-search.html',
  styleUrl: './catalog-search.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogSearch implements OnInit, OnDestroy {
  readonly pageSize = 20;
  mode: CatalogSearchType = 'supplier';
  keyword = '';
  category = '';
  statusFilter = '';
  productStatusFilter = '';
  categories: string[] = [];
  loadingCategories = false;
  searchedKeyword = '';
  searchedCategory = '';
  searchedStatus = '';
  searchedProductStatus = '';
  loading = false;
  hasSearched = false;
  errorMessage = '';
  supplierResults: SupplierSearchResult[] = [];
  productResults: ProductSearchResult[] = [];
  pagination: CatalogPagination = { page: 1, limit: this.pageSize, total: 0, totalPages: 1 };

  private request?: Subscription;
  private categoryRequest?: Subscription;

  constructor(
    private readonly catalogSearch: CatalogSearchService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadCategories();
    this.search(1);
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
    this.categoryRequest?.unsubscribe();
  }

  selectMode(mode: CatalogSearchType): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.category = '';
    this.statusFilter = '';
    this.productStatusFilter = '';
    this.errorMessage = '';
    this.hasSearched = false;
    this.searchedKeyword = '';
    this.searchedCategory = '';
    this.searchedStatus = '';
    this.searchedProductStatus = '';
    this.supplierResults = [];
    this.productResults = [];
    this.pagination = { page: 1, limit: this.pageSize, total: 0, totalPages: 1 };
    this.request?.unsubscribe();
    this.loading = false;
    this.loadCategories();
    this.search(1);
  }

  onCategoryChange(): void {
    this.search(1);
  }

  onStatusChange(): void {
    this.search(1);
  }

  onProductStatusChange(): void {
    this.search(1);
  }

  search(page = 1): void {
    const keyword = this.keyword.trim();
    if (keyword && keyword.length < 2) {
      this.errorMessage = 'Keyword must contain at least 2 characters.';
      this.hasSearched = false;
      return;
    }

    this.request?.unsubscribe();
    this.loading = true;
    this.errorMessage = '';

    const result$: Observable<
      CatalogSearchResponse<SupplierSearchResult | ProductSearchResult>
    > =
      this.mode === 'supplier'
        ? this.catalogSearch.searchSuppliers(keyword, this.category, this.statusFilter, page, this.pageSize)
        : this.catalogSearch.searchProducts(keyword, this.category, this.statusFilter, this.productStatusFilter, page, this.pageSize);

    this.request = result$.subscribe({
      next: (response) => {
        if (response.type === 'supplier') {
          this.supplierResults = response.results as SupplierSearchResult[];
          this.productResults = [];
        } else {
          this.productResults = response.results as ProductSearchResult[];
          this.supplierResults = [];
        }
        this.pagination = response.pagination;
        this.searchedKeyword = response.keyword;
        this.searchedCategory = response.category || '';
        this.searchedStatus = response.status || '';
        this.searchedProductStatus = response.productStatus || '';
        this.hasSearched = true;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage = 'Search failed. Please try again.';
        this.hasSearched = false;
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  previousPage(): void {
    if (this.pagination.page > 1) this.search(this.pagination.page - 1);
  }

  nextPage(): void {
    if (this.pagination.page < this.pagination.totalPages) this.search(this.pagination.page + 1);
  }

  get placeholder(): string {
    return this.mode === 'supplier'
      ? 'Search by supplier name, location, or category...'
      : 'Search by product name, location, category, or details...';
  }

  get modeTitle(): string {
    return this.mode === 'supplier' ? 'Supplier' : 'Product';
  }

  get searchTitle(): string {
    const statusLabel: Record<string, string> = {
      active: 'Active',
      inactive: 'Inactive',
      offer: 'On offer',
      not_on_offer: 'Not on offer',
    };
    const parts = [
      this.searchedKeyword,
      this.searchedCategory,
      statusLabel[this.searchedStatus] || '',
      this.searchedProductStatus === 'one_time_product'
        ? 'One Time Product'
        : this.searchedProductStatus === 'regular_product'
          ? 'Regular Product'
          : '',
    ].filter(Boolean);
    return parts.join(' / ') || `All ${this.modeTitle}s`;
  }

  private loadCategories(): void {
    this.categoryRequest?.unsubscribe();
    this.loadingCategories = true;
    this.categories = [];
    const requestedMode = this.mode;
    this.categoryRequest = this.catalogSearch.getCategories(requestedMode).subscribe({
      next: (response) => {
        if (this.mode === requestedMode) this.categories = response.categories;
        this.loadingCategories = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingCategories = false;
        this.cdr.markForCheck();
      },
    });
  }

  locationOf(row: SupplierSearchResult | ProductSearchResult): string {
    return [row.location, row.town, row.region].filter(Boolean).join(', ') || 'Location unavailable';
  }

  matchedFieldLabel(field: string): string {
    const labels: Record<string, string> = {
      company_name: 'supplier name',
      product_name: 'product name',
      location: 'location',
      town: 'town',
      region: 'region',
      address: 'address',
      category_supplier: 'supplier category',
      product_type: 'product type',
      product_status: 'product status',
      info: 'info',
      description: 'description',
      instructions: 'instructions',
      services_included: 'inclusion',
      services_excluded: 'exclusion',
      not_on_offer: 'not on offer',
      supplier_status: 'supplier status',
      multiple_fields: 'multiple fields',
    };
    return labels[field] || 'related information';
  }

  trackSupplier(_index: number, row: SupplierSearchResult): number {
    return row.supplier_id;
  }

  trackProduct(_index: number, row: ProductSearchResult): number {
    return row.product_id;
  }
}
