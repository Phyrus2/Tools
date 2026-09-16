import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CatalogSearch } from './catalog-search';

describe('CatalogSearch', () => {
  let component: CatalogSearch;
  let fixture: ComponentFixture<CatalogSearch>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogSearch],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CatalogSearch);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) =>
      request.url.endsWith('/catalog/categories') && request.params.get('type') === 'supplier'
    ).flush({ success: true, type: 'supplier', categories: ['ACCOMMODATION'] });
    http.expectOne((request) =>
      request.url.endsWith('/catalog/search') &&
      request.params.get('type') === 'supplier' &&
      !request.params.has('keyword') &&
      !request.params.has('category') &&
      !request.params.has('status')
    ).flush({
      success: true,
      type: 'supplier',
      keyword: '',
      category: null,
      status: null,
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      results: [{
        supplier_id: 1,
        company_name: 'Supplier Ubud',
        address: null,
        town: 'Ubud',
        region: 'Bali',
        location: 'Ubud',
        category_supplier: ['ACCOMMODATION'],
        status: 'Active',
        product_count: 2,
        matched_field: 'all',
      }],
    });
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('starts in supplier mode', () => {
    expect(component.mode).toBe('supplier');
    expect(component.hasSearched).toBe(true);
    expect(component.supplierResults.length).toBe(1);
  });

  it('switches clearly to product mode and clears stale results', () => {
    component.supplierResults = [
      {
        supplier_id: 1,
        company_name: 'Supplier Ubud',
        address: null,
        town: 'Ubud',
        region: 'Bali',
        location: 'Ubud',
        category_supplier: ['ACCOMMODATION'],
        status: 'Active',
        product_count: 2,
        matched_field: 'location',
      },
    ];

    component.selectMode('product');

    expect(component.mode).toBe('product');
    expect(component.supplierResults).toEqual([]);
    expect(component.hasSearched).toBe(false);
  });
});
