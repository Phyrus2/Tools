import { API_URL } from './api-config';
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
 
export interface ProductChange {
  field: string;
  old: unknown;
  new: unknown;
}

export interface ProductRow {
  row: number;
  product_id: string;
  supplier_id: string;
  name: string;
  type: string | null;
  status: 'Regular Product' | 'One Time Product';
  info: string | null;
  not_on_offer: string | null;
  services_included: string | null;
  services_excluded: string | null;
  instructions: string | null;
  description: string | null;
  changes?: ProductChange[];
}
 
export interface SkippedProduct {
  row: number;
  reason: string;
}
 
export interface ProductImportResult {
  success: boolean;
  message: string;
 
  summary: {
    totalRows: number;
    inserted: number;
    updated: number;
    unchanged: number;
    skipped: number;
  };
 
  insertedRows: ProductRow[];
  updatedRows: ProductRow[];
  unchangedRows: ProductRow[];
  skippedRows: SkippedProduct[];
}

@Injectable({
  providedIn: 'root',
})
export class Product {
   private apiUrl = API_URL;
 
  constructor(private http: HttpClient) {}
 
  importProduct(file: File): Observable<ProductImportResult> {
    const formData = new FormData();
    formData.append('file', file);
 
    return this.http.post<ProductImportResult>(
      `${this.apiUrl}/product/import`,
      formData,
    );
  }
}
