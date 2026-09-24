import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './api-config';

export interface HotelOption {
  id: number;
  option_year: number;
  option_code: 'A' | 'B' | 'C' | null;
  supplier_id: number | null;
  product_id: number | null;
  company_name: string | null;
  product_name: string | null;
  region: string;
  location: string;
  segment: string | null;
  hotel_name: string;
  room_type: string | null;
  quote_amount: number | null;
  high_season_surcharge: number | null;
  high_season_period: string | null;
  peak_season_period: string | null;
  remarks: string | null;
  update_count: number;
}

export interface HotelLinkSupplier {
  supplier_id: number;
  company_name: string;
  location: string | null;
  region: string | null;
}
export interface HotelLinkProduct {
  product_id: number;
  supplier_id: number;
  name: string;
  type: string | null;
}
export interface HotelOptionRevision {
  id: number;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  changed_at: string;
}
export interface HotelOptionInput {
  option_year: number;
  option_code: 'A' | 'B' | 'C';
  region: string;
  location: string;
  segment: string | null;
  hotel_name: string;
  room_type: string;
  supplier_id: number | null;
  product_id: number | null;
}
export interface HotelImportRow {
  id?: number;
  sheet_name?: string;
  row_number?: number;
  region?: string;
  source_row?: number;
  hotel_name: string;
  room_type: string | null;
  reason?: string;
  changes?: { field: string; old: unknown; new: unknown }[];
}
export interface HotelImportResult {
  success: true;
  year: number;
  summary: {
    totalRows: number;
    inserted: number;
    updated: number;
    unchanged: number;
    skipped: number;
    unmatched: number;
  };
  newRows: HotelImportRow[];
  updatedRows: HotelImportRow[];
  unchangedRows: HotelImportRow[];
  skippedRows: HotelImportRow[];
}

@Injectable({ providedIn: 'root' })
export class HotelOptionsService {
  constructor(private readonly http: HttpClient) {}
  list(
    filters: { year: number; region?: string; location?: string; status?: string },
    page = 1,
    limit = 50,
  ): Observable<{
    success: true;
    page: number;
    limit: number;
    total: number;
    year: number;
    available_years: number[];
    options: HotelOption[];
    filter_options: { region: string; location: string }[];
  }> {
    let params = new HttpParams().set('page', String(page)).set('limit', String(limit));
    for (const [key, value] of Object.entries(filters)) if (value) params = params.set(key, value);
    return this.http.get<{
      success: true;
      page: number;
      limit: number;
      total: number;
      year: number;
      available_years: number[];
      options: HotelOption[];
      filter_options: { region: string; location: string }[];
    }>(`${API_URL}/hotel-options`, { params });
  }
  import(file: File, year: number): Observable<HotelImportResult> {
    const form = new FormData();
    form.append('year', String(year));
    form.append('file', file);
    return this.http.post<HotelImportResult>(`${API_URL}/hotel-options/import`, form);
  }
  assign(
    id: number,
    supplierId: number,
    productId: number,
  ): Observable<{ success: true; supplier: HotelLinkSupplier; product: HotelLinkProduct }> {
    return this.http.patch<{
      success: true;
      supplier: HotelLinkSupplier;
      product: HotelLinkProduct;
    }>(`${API_URL}/hotel-options/${id}/supplier`, {
      supplier_id: supplierId,
      product_id: productId,
    });
  }
  searchLinks(
    query: string,
    supplierId?: number,
  ): Observable<{ success: true; suppliers: HotelLinkSupplier[]; products: HotelLinkProduct[] }> {
    let params = new HttpParams().set('q', query);
    if (supplierId) params = params.set('supplier_id', supplierId);
    return this.http.get<{
      success: true;
      suppliers: HotelLinkSupplier[];
      products: HotelLinkProduct[];
    }>(`${API_URL}/hotel-options/link-search`, { params });
  }
  history(id: number): Observable<{ success: true; history: HotelOptionRevision[] }> {
    return this.http.get<{ success: true; history: HotelOptionRevision[] }>(
      `${API_URL}/hotel-options/${id}/history`,
    );
  }
  create(input: HotelOptionInput): Observable<{ success: true; id: number; message: string }> {
    return this.http.post<{ success: true; id: number; message: string }>(
      `${API_URL}/hotel-options`,
      input,
    );
  }
  update(
    id: number,
    input: HotelOptionInput,
  ): Observable<{ success: true; id: number; message: string }> {
    return this.http.patch<{ success: true; id: number; message: string }>(
      `${API_URL}/hotel-options/${id}`,
      input,
    );
  }
  delete(id: number): Observable<{ success: true; message: string }> {
    return this.http.delete<{ success: true; message: string }>(`${API_URL}/hotel-options/${id}`);
  }
}
