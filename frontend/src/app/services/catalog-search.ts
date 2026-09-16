import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './api-config';

export type CatalogSearchType = 'supplier' | 'product';

export interface CatalogPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SupplierSearchResult {
  supplier_id: number;
  company_name: string;
  address: string | null;
  town: string | null;
  region: string | null;
  location: string | null;
  category_supplier: string[];
  status: 'Active' | 'Inactive';
  product_count: number;
  matched_field: string;
}

export interface ProductSearchResult {
  product_id: number;
  name: string;
  type: string | null;
  status: 'Regular Product' | 'One Time Product';
  info: string | null;
  not_on_offer: boolean | null;
  services_included: string | null;
  services_excluded: string | null;
  instructions: string | null;
  description: string | null;
  supplier_id: number;
  company_name: string;
  address: string | null;
  town: string | null;
  region: string | null;
  location: string | null;
  category_supplier: string[];
  has_compulsory_dinner: boolean | null;
  matched_field: string;
}

export interface CatalogSearchResponse<T> {
  success: true;
  type: CatalogSearchType;
  keyword: string;
  category: string | null;
  status: string | null;
  productStatus: string | null;
  pagination: CatalogPagination;
  results: T[];
}

@Injectable({ providedIn: 'root' })
export class CatalogSearchService {
  constructor(private readonly http: HttpClient) {}

  searchSuppliers(keyword: string, category: string, status: string, page = 1, limit = 20): Observable<CatalogSearchResponse<SupplierSearchResult>> {
    return this.http.get<CatalogSearchResponse<SupplierSearchResult>>(
      `${API_URL}/catalog/search`,
      { params: this.params('supplier', keyword, category, status, page, limit) },
    );
  }

  searchProducts(keyword: string, category: string, status: string, productStatus: string, page = 1, limit = 20): Observable<CatalogSearchResponse<ProductSearchResult>> {
    return this.http.get<CatalogSearchResponse<ProductSearchResult>>(
      `${API_URL}/catalog/search`,
      { params: this.params('product', keyword, category, status, page, limit, productStatus) },
    );
  }

  getCategories(type: CatalogSearchType): Observable<{ success: true; type: CatalogSearchType; categories: string[] }> {
    return this.http.get<{ success: true; type: CatalogSearchType; categories: string[] }>(
      `${API_URL}/catalog/categories`,
      { params: new HttpParams().set('type', type) },
    );
  }

  private params(type: CatalogSearchType, keyword: string, category: string, status: string, page: number, limit: number, productStatus = ''): HttpParams {
    let params = new HttpParams()
      .set('type', type)
      .set('page', String(page))
      .set('limit', String(limit));

    if (keyword.trim()) params = params.set('keyword', keyword.trim());
    if (category) params = params.set('category', category);
    if (status) params = params.set('status', status);
    if (productStatus) params = params.set('productStatus', productStatus);
    return params;
  }
}
