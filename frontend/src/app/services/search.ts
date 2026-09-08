import { API_URL } from './api-config';
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
 
// =====================================================
// IMPORT — types (sudah ada sebelumnya)
// =====================================================
 
export interface BookedProductRow {
  row: number;
  id: number;
  dossier_id: string | null;
  dossier_name: string | null;
  supplier_id: number;
  product_id: number;
  product_name: string;
  status: string | null;
  travel_date: string | null;
  price: number | null;
  changes?: BookedProductChange[];
}
 
export interface BookedProductChange {
  field: string;
  old: any;
  new: any;
}
 
export interface UnchangedBookedProduct {
  row: number;
  id: number;
  dossier_id: string | null;
  dossier_name: string | null;
  product_name: string;
}
 
export interface SkippedBookedProduct {
  row: number;
  reason: string;
  supplier_name?: string | null;
  product_name?: string | null;
}
 
export interface BookedProductImportResult {
  success: boolean;
  message: string;
 
  summary: {
    totalRows: number;
    inserted: number;
    updated: number;
    unchanged: number;
    skipped: number;
  };
 
  insertedRows: BookedProductRow[];
  updatedRows: BookedProductRow[];
  unchangedRows: UnchangedBookedProduct[];
  skippedRows: SkippedBookedProduct[];
}
 
// =====================================================
// SEARCH — types (baru)
// =====================================================
 
export type MatchedField =
  | 'company_name'
  | 'address'
  | 'town'
  | 'region'
  | 'location'
  | 'product_name'
  | 'description'
  | 'info'
  | 'instructions'
  | 'travel_date'
  | 'other';
 
export interface BookedProductSearchResult {
  id: number;
  dossier_id: string | null;
  dossier_name: string | null;
  product_id: number;
  product_name: string;
  status: string | null;
  travel_date: string | null;
  end_date: string | null;
  price: number | null;
  description: string | null;
  info: string | null;
  instructions: string | null;
  supplier_id: number;
  company_name: string;
  address: string | null;
  town: string | null;
  region: string | null;
  location: string | null;
  matched_field: MatchedField;
  sales: string | null;        // 👈 tambahan
  operational: string | null; 
  duration: number | null;
  duration_unit: 'D' | 'N' | null;
  quantity: number | null;
  unit: string | null;
}
 
export interface BookedProductSearchFilters {
  date: string | null;
  startDate: string | null;
  endDate: string | null;
}
 
export interface BookedProductSearchPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
 
export interface BookedProductSearchResponse {
  success: boolean;
  keyword: string;
  filters: BookedProductSearchFilters;
  pagination: BookedProductSearchPagination;
  results: BookedProductSearchResult[];
}
 
export interface BookedProductSearchErrorResponse {
  success: false;
  message: string;
}
 
/**
 * Parameter pencarian.
 *
 * - `date` dan (`startDate`/`endDate`) saling eksklusif.
 *   Kalau `date` diisi, backend mengabaikan startDate/endDate.
 * - `startDate` saja mencari booking yang masih berlangsung atau dimulai
 *   pada/setelah tanggal tersebut.
 * - `endDate` saja mencari booking pada/sebelum tanggal tersebut.
 * - Semua tanggal wajib format YYYY-MM-DD.
 */
export interface BookedProductSearchParams {
  keyword: string;
  date?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  page?: number;
  limit?: number;
}

@Injectable({
  providedIn: 'root',
})
export class Search {
  private apiUrl = API_URL;
 
  constructor(private http: HttpClient) {}
 
  // =====================================================
  // IMPORT
  // =====================================================
 
  importBookedProduct(file: File): Observable<BookedProductImportResult> {
    const formData = new FormData();
    formData.append('file', file);
 
    return this.http.post<BookedProductImportResult>(
      `${this.apiUrl}/booked-product/import`,
      formData,
    );
  }
 
  // =====================================================
  // SEARCH
  // =====================================================
 
  searchBookedProduct(
    params: BookedProductSearchParams,
  ): Observable<BookedProductSearchResponse> {
    let httpParams = new HttpParams();

    if (params.keyword.trim()) {
      httpParams = httpParams.set('keyword', params.keyword.trim());
    }
 
    // date bersifat eksklusif terhadap startDate/endDate,
    // konsisten dengan validasi di backend.
    if (params.date) {
      httpParams = httpParams.set('date', params.date);
    } else {
      if (params.startDate) {
        httpParams = httpParams.set('startDate', params.startDate);
      }
      if (params.endDate) {
        httpParams = httpParams.set('endDate', params.endDate);
      }
    }
 
    httpParams = httpParams
      .set('page', String(params.page ?? 1))
      .set('limit', String(params.limit ?? 50));
 
    return this.http.get<BookedProductSearchResponse>(
      `${this.apiUrl}/booked-product/search`,
      { params: httpParams },
    );
  }

}
