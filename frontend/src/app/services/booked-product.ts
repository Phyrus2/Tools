import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
 
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

export interface BookedProductImportStatus {
  fileName: string;
  totalRows: number;
  importedAt: string;
}
 
export interface BookedProductImportResult {
  success: boolean;
  message: string;
  lastImport: BookedProductImportStatus | null;
 
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
 
@Injectable({
  providedIn: 'root',
})

export class BookedProduct {
  private apiUrl = 'http://localhost:3000';
 
  constructor(private http: HttpClient) {}
 
  importBookedProduct(file: File): Observable<BookedProductImportResult> {
    const formData = new FormData();
    formData.append('file', file);
 
    return this.http.post<BookedProductImportResult>(
      `${this.apiUrl}/booked-product/import`,
      formData,
    );
  }

  getImportStatus(): Observable<{
    success: boolean;
    lastImport: BookedProductImportStatus | null;
  }> {
    return this.http.get<{
      success: boolean;
      lastImport: BookedProductImportStatus | null;
    }>(`${this.apiUrl}/booked-product/import/status`);
  }
}
