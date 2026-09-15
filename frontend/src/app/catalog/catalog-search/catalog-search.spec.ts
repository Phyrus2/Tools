import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
    await fixture.whenStable();
  });

  it('starts in supplier mode', () => {
    expect(component.mode).toBe('supplier');
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
