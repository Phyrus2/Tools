import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
 
export interface ProductRow {
  row: number;
  product_id: string;
  supplier_id: string;
  name: string;
  type: string | null;
  status: string;
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
   private apiUrl = 'http://localhost:3000';
 
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
