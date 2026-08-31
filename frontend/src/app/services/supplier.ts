import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SupplierChange {
  field: string;
  old: any;
  new: any;
}

export interface InsertedSupplier {
  row: number;
  supplier_id: string;
  company_name: string;
  town: string | null;
  region: string | null;
  location: string | null;
  category_supplier: string[];
}

export interface UpdatedSupplier {
  row: number;
  supplier_id: string;
  company_name: string;
  changes: SupplierChange[];
}

export interface UnchangedSupplier {
  row: number;
  supplier_id: string;
  company_name: string;
}

export interface SkippedSupplier {
  row: number;
  reason: string;
}

export interface ImportResult {
  success: boolean;
  message: string;
  category: string;

  summary: {
    totalRows: number;
    inserted: number;
    updated: number;
    unchanged: number;
    skipped: number;
  };

  insertedRows: InsertedSupplier[];
  updatedRows: UpdatedSupplier[];
  unchangedRows: UnchangedSupplier[];
  skippedRows: SkippedSupplier[];
}

@Injectable({
  providedIn: 'root',
})
export class Supplier {
  private apiUrl = 'http://localhost:3000';

  constructor(private http: HttpClient) {}

  importSupplier(file: File, category: string): Observable<ImportResult> {
    const formData = new FormData();

    formData.append('file', file);
    formData.append('category', category);

    return this.http.post<ImportResult>(`${this.apiUrl}/supplier/import`, formData);
  }
}
