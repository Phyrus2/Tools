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
  importId: number;
  canUndo: boolean;

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

export interface SupplierImportHistory {
  importId: number;
  fileName: string;
  category: string;
  totalRows: number;
  importedAt: string;
  undoneAt: string | null;
  pendingChanges: number;
  canUndo: boolean;
}

export interface UndoSupplierImportResult {
  success: boolean;
  message: string;
  restored: number;
  conflicts: number;
  conflictSupplierIds: number[];
  canRetry: boolean;
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

  getLatestImport(): Observable<{
    success: boolean;
    latest: SupplierImportHistory | null;
  }> {
    return this.http.get<{
      success: boolean;
      latest: SupplierImportHistory | null;
    }>(`${this.apiUrl}/supplier/import/latest`);
  }

  undoImport(importId: number): Observable<UndoSupplierImportResult> {
    return this.http.post<UndoSupplierImportResult>(
      `${this.apiUrl}/supplier/import/${importId}/undo`,
      {},
    );
  }
}
