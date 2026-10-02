import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './api-config';

export interface StopSaleSource {
  id: number;
  server_id: string;
  year: number;
  base_path: string;
  target_folder: string;
  module_key: 'INFO_STOP_SALES';
  enabled: number | boolean;
  last_successful_checkpoint_utc: string | null;
}

export interface StopSaleScan {
  id: number;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  total_files: number;
  new_files: number;
  warning_count: number;
  started_at: string | null;
  finished_at: string | null;
}

export interface StopSaleScanResult {
  id: number;
  file_name: string;
  full_path: string;
  extension: string | null;
  date_modified_utc: string;
  file_size: number;
  processed: number | boolean;
  pending_id: number | null;
}

export interface StopSaleJob {
  id: number;
  scan_result_id: number;
  supplier_id: number | null;
  company_name: string | null;
  supplier_location: string | null;
  file_name: string;
  full_path: string;
  extension: string | null;
  date_modified_utc: string;
  file_size: number;
  uploaded_file_name: string | null;
  uploaded_mime_type: string | null;
  uploaded_file_size: number | null;
  status: string;
  document_type: 'FULL_SNAPSHOT' | 'INCREMENTAL' | 'UNKNOWN';
  is_active_baseline: boolean;
  note: string | null;
  completed_at: string | null;
  completed_by_name: string | null;
  source_diff: SourceDiff[];
}

export interface SourceDiff {
  sheet: string | null;
  cell: string | null;
  before: string | null;
  after: string | null;
  change: string;
  note?: string;
}

export interface StopSaleItem {
  id?: number;
  job_id?: number;
  product_id: number | null;
  product_name?: string | null;
  detected_product_name: string | null;
  restriction_status: 'STOP_SALE' | 'ON_REQUEST';
  start_date: string;
  end_date: string;
  confidence?: number | null;
  source_reference?: unknown;
}

export interface StopSaleAction {
  product_id: number | null;
  product_name: string;
  restriction_status: 'STOP_SALE' | 'ON_REQUEST';
  change: 'ADDED' | 'REMOVED' | 'UPDATED' | 'UNCHANGED';
  start_date: string;
  end_date: string;
}

export interface StopSaleDetail {
  job: StopSaleJob;
  items: StopSaleItem[];
  baseline: StopSaleJob | null;
  baseline_items: StopSaleItem[];
  comparison: {
    actions: StopSaleAction[];
    summary: { added_days: number; removed_days: number; updated_days?: number; unchanged_days: number };
  };
}

export interface StopSaleSupplier {
  supplier_id: number;
  company_name: string;
  location: string | null;
}

export interface StopSaleProduct {
  product_id: number;
  name: string;
  type: string | null;
  status: string;
}

export interface StopSaleReport {
  job_id: number;
  supplier_id: number;
  company_name: string;
  in_dropbox_email: string;
  in_jambix: string;
  user_who_update: string;
  note: string | null;
  detected_change_count: number;
}

@Injectable({ providedIn: 'root' })
export class StopSalesService {
  private readonly base = `${API_URL}/stop-sales`;

  constructor(private readonly http: HttpClient) {}

  listSources(): Observable<{ success: true; server_id: string; sources: StopSaleSource[] }> {
    return this.http.get<{ success: true; server_id: string; sources: StopSaleSource[] }>(`${this.base}/scan-sources`);
  }

  createSource(body: Omit<StopSaleSource, 'id' | 'module_key' | 'last_successful_checkpoint_utc'>): Observable<unknown> {
    return this.http.post(`${this.base}/scan-sources`, { ...body, module_key: 'INFO_STOP_SALES' });
  }

  updateSource(source: StopSaleSource): Observable<unknown> {
    return this.http.patch(`${this.base}/scan-sources/${source.id}`, { ...source, enabled: !Boolean(source.enabled) });
  }

  deleteSource(id: number): Observable<unknown> {
    return this.http.delete(`${this.base}/scan-sources/${id}`);
  }

  startScan(body: { mode: 'AUTO' | 'CUSTOM'; start?: string; end?: string }): Observable<{ success: true; scan_id: number }> {
    return this.http.post<{ success: true; scan_id: number }>(`${this.base}/scans`, body);
  }

  getScan(id: number): Observable<{ success: true; scan: StopSaleScan }> {
    return this.http.get<{ success: true; scan: StopSaleScan }>(`${this.base}/scans/${id}`);
  }

  getResults(id: number): Observable<{ success: true; results: StopSaleScanResult[]; total: number }> {
    return this.http.get<{ success: true; results: StopSaleScanResult[]; total: number }>(`${this.base}/scans/${id}/results`, {
      params: new HttpParams().set('limit', '100'),
    });
  }

  createJob(scanResultId: number): Observable<{ success: true; job_id: number }> {
    return this.http.post<{ success: true; job_id: number }>(`${this.base}/scan-results/${scanResultId}/jobs`, {});
  }

  listJobs(): Observable<{ success: true; total: number; jobs: StopSaleJob[] }> {
    return this.http.get<{ success: true; total: number; jobs: StopSaleJob[] }>(`${this.base}/jobs`, {
      params: new HttpParams().set('limit', '100'),
    });
  }

  getJob(id: number): Observable<StopSaleDetail & { success: true }> {
    return this.http.get<StopSaleDetail & { success: true }>(`${this.base}/jobs/${id}`);
  }

  updateJob(id: number, body: { supplier_id: number; document_type: string; note: string | null }): Observable<unknown> {
    return this.http.patch(`${this.base}/jobs/${id}`, body);
  }

  uploadJobFile(id: number, file: File): Observable<unknown> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post(`${this.base}/jobs/${id}/upload`, form);
  }

  processJob(id: number): Observable<unknown> {
    return this.http.post(`${this.base}/jobs/${id}/process`, {});
  }

  saveItems(id: number, items: StopSaleItem[]): Observable<unknown> {
    return this.http.put(`${this.base}/jobs/${id}/items`, { items });
  }

  completeJob(id: number): Observable<unknown> {
    return this.http.post(`${this.base}/jobs/${id}/complete`, {});
  }

  searchSuppliers(query: string): Observable<{ success: true; suppliers: StopSaleSupplier[] }> {
    return this.http.get<{ success: true; suppliers: StopSaleSupplier[] }>(`${this.base}/suppliers`, {
      params: query.trim() ? new HttpParams().set('q', query.trim()) : undefined,
    });
  }

  listProducts(supplierId: number): Observable<{ success: true; products: StopSaleProduct[] }> {
    return this.http.get<{ success: true; products: StopSaleProduct[] }>(`${this.base}/products`, {
      params: new HttpParams().set('supplier_id', supplierId),
    });
  }

  listReports(): Observable<{ success: true; reports: StopSaleReport[] }> {
    return this.http.get<{ success: true; reports: StopSaleReport[] }>(`${this.base}/reports`);
  }
}
