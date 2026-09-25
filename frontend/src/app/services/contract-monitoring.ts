import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './api-config';

export type ScanStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
export type SignedStatus = 'SIGNED' | 'BELUM_SIGNED' | 'DRAFT';
export type PendingAction = 'INSERT' | 'UPDATE';

export interface ScanSource {
  id: number;
  server_id: string;
  year: number;
  base_path: string;
  target_folder: string;
  module_key: 'CONTRACT' | 'INFO_STOP_SALES' | 'QUOTE_TICKET';
  enabled: number | boolean;
  last_successful_checkpoint_utc: string | null;
}

export interface ScanRunSource extends ScanSource {
  source_id: number;
  window_start_utc: string;
  window_end_utc: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  error_message: string | null;
}

export interface ScanRun {
  id: number;
  server_id: string;
  mode: 'AUTO' | 'CUSTOM';
  status: ScanStatus;
  total_files: number;
  new_files: number;
  warning_count: number;
  error_summary: unknown;
  started_at: string | null;
  finished_at: string | null;
  sources: ScanRunSource[];
}

export interface ScanResult {
  id: number;
  full_path: string;
  parent_path: string;
  file_name: string;
  extension: string | null;
  date_modified_utc: string;
  file_size: number | null;
  detected_signed_status: SignedStatus;
  processed: number | boolean;
  year: number;
  module_key: string;
  pending_id: number | null;
  pending_status: string | null;
}

export interface SupplierRecommendation {
  id: number;
  name: string;
  score: number;
  category_supplier: string[];
  location: string | null;
}

export interface GroupRecommendation {
  id: number;
  name: string;
  score: number;
}

export interface ScanResultAnalysis {
  result: ScanResult & { source_id: number; base_path: string; target_folder: string };
  normalized_file_name: string;
  supplier_recommendations: SupplierRecommendation[];
  management_group_recommendations: GroupRecommendation[];
}

export interface ExistingContract {
  id: number;
  file_source: string;
  location_jambix: string | null;
  supplier_type: string;
  validity_start: string;
  validity_end: string;
  status: 'ACTIVE' | 'EXPIRED';
  source_status: string | null;
  contract_reference: string | null;
  signed_status: SignedStatus;
  note: string | null;
}

export interface PendingSupplier {
  id?: number;
  supplier_id: number | null;
  detected_supplier_name?: string | null;
  company_name: string;
  category_supplier: string[];
  supplier_location?: string | null;
  recommendation_source: 'FUZZY' | 'GROUP' | 'MANUAL';
  match_score: number | null;
  detection: 'NO_MATCH' | 'SUPPLIER_MATCH' | 'ACTIVE_CONTRACT';
  action: PendingAction | null;
  target_contract_report_id: number | null;
  supplier_type: string | null;
  location_jambix: string | null;
  validity_start: string | null;
  validity_end: string | null;
  contract_reference: string | null;
  signed_status: SignedStatus;
  note: string | null;
  active_contracts: ExistingContract[];
}

export interface PendingItem {
  id: number;
  scan_result_id: number;
  is_management_contract: number | boolean;
  management_group_id: number | null;
  management_group_name: string | null;
  management_name: string | null;
  status: 'NEW' | 'IN_PROGRESS' | 'DONE' | 'IGNORED';
  version: number;
  note: string | null;
  full_path: string;
  parent_path: string;
  file_name: string;
  detected_signed_status: SignedStatus;
  suppliers: PendingSupplier[];
  group_members_not_selected: { supplier_id: number; company_name: string }[];
}

export interface PendingFileItem {
  id: number;
  scan_result_id: number;
  file_name: string;
  full_path: string;
  status: PendingItem['status'];
  workflow_state:
    'UNHANDLED' | 'IN_PROGRESS' | 'OP_NO_RESPONSE' | 'OP_WAITING' | 'DB_PENDING_VARIANT';
  contract_period: string;
  year: number;
  note: string | null;
  is_management_contract: number | boolean;
  management_group_name: string | null;
  claimed_by_name: string | null;
  version: number;
  date_modified_utc: string;
  detected_signed_status: SignedStatus;
}

export interface PendingSupplierGroup {
  supplier_id: number | null;
  company_name: string;
  supplier_location: string | null;
  category_supplier: string[];
  supplier_type: string | null;
  jambix_status: 'IN_JAMBIX' | 'NOT_IN_JAMBIX';
  has_booked_product: boolean;
  has_hotel_option: boolean;
  files: PendingFileItem[];
}

export interface PendingQueueGroup {
  key: string;
  is_management: boolean;
  management_group_id: number | null;
  management_group_name: string | null;
  suppliers: PendingSupplierGroup[];
}

export interface ManagementGroup {
  id: number;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  active_member_count: number;
}

export interface ContractReport {
  id: number;
  file_source: string;
  location_jambix: string | null;
  region: string | null;
  supplier_id: number;
  company_name: string;
  supplier_type: string;
  validity_start: string;
  validity_end: string;
  status: 'ACTIVE' | 'EXPIRED';
  source_status: string | null;
  contract_reference: string | null;
  signed_status: SignedStatus;
  period_statuses: { period: string; status: 'SIGNED' | 'DONE' | 'PENDING' }[];
  has_hotel_option: boolean;
  note: string | null;
  category_supplier: string[];
}

export interface ContractImportItem {
  id?: number;
  sheet_name: string;
  row_number: number;
  supplier_name: string | null;
  reason?: string;
  can_link_supplier?: boolean;
  payload: Record<string, unknown>;
  changes?: { field: string; old: unknown; new: unknown }[];
}
export interface ContractImportResult {
  success: true;
  summary: {
    totalRows: number;
    inserted: number;
    updated: number;
    unchanged: number;
    skipped: number;
  };
  newRows: ContractImportItem[];
  updatedRows: ContractImportItem[];
  unchangedRows: ContractImportItem[];
  skippedRows: ContractImportItem[];
}

@Injectable({ providedIn: 'root' })
export class ContractMonitoringService {
  private readonly base = `${API_URL}/contract-monitoring`;

  constructor(private readonly http: HttpClient) {}

  listSources(): Observable<{ success: true; server_id: string; sources: ScanSource[] }> {
    return this.http.get<{ success: true; server_id: string; sources: ScanSource[] }>(
      `${this.base}/scan-sources`,
    );
  }

  createSource(
    source: Omit<ScanSource, 'id' | 'last_successful_checkpoint_utc'>,
  ): Observable<{ success: true; id: number }> {
    return this.http.post<{ success: true; id: number }>(`${this.base}/scan-sources`, source);
  }

  updateSource(
    id: number,
    source: Omit<ScanSource, 'id' | 'last_successful_checkpoint_utc'>,
  ): Observable<unknown> {
    return this.http.patch(`${this.base}/scan-sources/${id}`, source);
  }

  deleteSource(id: number): Observable<{ success: true; message: string }> {
    return this.http.delete<{ success: true; message: string }>(`${this.base}/scan-sources/${id}`);
  }

  startScan(body: {
    mode: 'AUTO' | 'CUSTOM';
    start?: string;
    end?: string;
  }): Observable<{ success: true; scan_id: number; status: ScanStatus }> {
    return this.http.post<{ success: true; scan_id: number; status: ScanStatus }>(
      `${this.base}/scans`,
      body,
    );
  }

  getScan(id: number): Observable<{ success: true; scan: ScanRun }> {
    return this.http.get<{ success: true; scan: ScanRun }>(`${this.base}/scans/${id}`);
  }

  getResults(
    id: number,
    processed?: boolean,
  ): Observable<{ success: true; total: number; results: ScanResult[] }> {
    let params = new HttpParams().set('limit', '100');
    if (processed !== undefined) params = params.set('processed', String(processed));
    return this.http.get<{ success: true; total: number; results: ScanResult[] }>(
      `${this.base}/scans/${id}/results`,
      { params },
    );
  }

  analyzeResult(id: number): Observable<ScanResultAnalysis & { success: true }> {
    return this.http.get<ScanResultAnalysis & { success: true }>(`${this.base}/scan-results/${id}`);
  }

  claimResult(id: number): Observable<{ success: true; pending_id: number }> {
    return this.http.post<{ success: true; pending_id: number }>(
      `${this.base}/scan-results/${id}/pending`,
      {},
    );
  }

  listPending(
    filters: { status?: string[]; category?: string[]; supplier_status?: string[] } = {},
    page = 1,
    limit = 20,
  ): Observable<{
    success: true;
    page: number;
    limit: number;
    total: number;
    categories: string[];
    pending: PendingQueueGroup[];
  }> {
    let params = new HttpParams().set('page', page).set('limit', limit);
    for (const value of filters.status || []) params = params.append('status', value);
    for (const value of filters.category || []) params = params.append('category', value);
    for (const value of filters.supplier_status || [])
      params = params.append('supplier_status', value);
    return this.http.get<{
      success: true;
      page: number;
      limit: number;
      total: number;
      categories: string[];
      pending: PendingQueueGroup[];
    }>(`${this.base}/pending`, { params });
  }

  importPending(file: File): Observable<{
    success: true;
    summary: { totalRows: number; inserted: number; skipped: number };
    skippedRows: {
      sheet_name: string;
      row_number: number;
      supplier_name: string;
      reason: string;
    }[];
  }> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{
      success: true;
      summary: { totalRows: number; inserted: number; skipped: number };
      skippedRows: {
        sheet_name: string;
        row_number: number;
        supplier_name: string;
        reason: string;
      }[];
    }>(`${this.base}/pending/import`, form);
  }

  getPending(id: number): Observable<{ success: true; pending: PendingItem }> {
    return this.http.get<{ success: true; pending: PendingItem }>(`${this.base}/pending/${id}`);
  }

  updatePending(
    id: number,
    body: {
      is_management_contract?: boolean;
      management_group_id?: number | null;
      management_name?: string | null;
      prefill_group_members?: boolean;
      note?: string;
    },
  ): Observable<unknown> {
    return this.http.patch(`${this.base}/pending/${id}`, body);
  }

  savePendingSuppliers(id: number, suppliers: PendingSupplier[]): Observable<unknown> {
    return this.http.put(`${this.base}/pending/${id}/suppliers`, {
      suppliers: suppliers.map(
        ({
          company_name: _companyName,
          category_supplier: _categories,
          supplier_location: _supplierLocation,
          active_contracts: _contracts,
          ...supplier
        }) => supplier,
      ),
    });
  }

  completePending(
    id: number,
    version: number,
  ): Observable<{ success: true; report_ids: number[] }> {
    return this.http.post<{ success: true; report_ids: number[] }>(
      `${this.base}/pending/${id}/complete`,
      { version },
    );
  }

  ignorePending(id: number, reason: string): Observable<unknown> {
    return this.http.post(`${this.base}/pending/${id}/ignore`, { reason });
  }

  releasePending(id: number): Observable<unknown> {
    return this.http.post(`${this.base}/pending/${id}/release`, {});
  }

  updateQueueMeta(
    id: number,
    workflowState: PendingFileItem['workflow_state'],
    note: string | null,
  ): Observable<{ success: true; message: string }> {
    return this.http.patch<{ success: true; message: string }>(
      `${this.base}/pending/${id}/queue-meta`,
      { workflow_state: workflowState, note },
    );
  }

  startPending(id: number): Observable<unknown> {
    return this.http.post(`${this.base}/pending/${id}/start`, {});
  }

  queueUnmatched(id: number): Observable<unknown> {
    return this.http.post(`${this.base}/pending/${id}/queue-unmatched`, {});
  }

  listGroups(): Observable<{ success: true; groups: ManagementGroup[] }> {
    return this.http.get<{ success: true; groups: ManagementGroup[] }>(
      `${this.base}/management-groups`,
    );
  }

  createGroup(name: string, supplierIds: number[]): Observable<{ success: true; id: number }> {
    return this.http.post<{ success: true; id: number }>(`${this.base}/management-groups`, {
      name,
      supplier_ids: supplierIds,
    });
  }

  assignPendingToManagement(body: {
    pending_ids: number[];
    group_id?: number;
    name?: string;
  }): Observable<{
    success: true;
    id: number;
    name: string;
    pending_count: number;
    supplier_count: number;
    message: string;
  }> {
    return this.http.post<{
      success: true;
      id: number;
      name: string;
      pending_count: number;
      supplier_count: number;
      message: string;
    }>(`${this.base}/management-groups/assign-pending`, body);
  }

  listReports(
    filters: {
      status?: string[];
      category?: string[];
      expiry_date?: string;
      region?: string[];
      location?: string[];
      supplier?: string;
    } = {},
    page = 1,
    limit = 100,
  ): Observable<{
    success: true;
    total: number;
    categories: string[];
    filter_options: { region: string; location: string }[];
    reports: ContractReport[];
  }> {
    let params = new HttpParams().set('page', String(page)).set('limit', String(limit));
    for (const value of filters.status || []) params = params.append('status', value);
    for (const value of filters.category || []) params = params.append('category', value);
    if (filters.expiry_date) params = params.set('expiry_date', filters.expiry_date);
    for (const value of filters.region || []) params = params.append('region', value);
    for (const value of filters.location || []) params = params.append('location', value);
    if (filters.supplier) params = params.set('supplier', filters.supplier);
    return this.http.get<{
      success: true;
      total: number;
      categories: string[];
      filter_options: { region: string; location: string }[];
      reports: ContractReport[];
    }>(`${this.base}/reports`, { params });
  }

  importReports(file: File): Observable<ContractImportResult> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ContractImportResult>(`${this.base}/reports/import`, form);
  }
  addSkippedReport(
    item: ContractImportItem,
    supplierId: number,
  ): Observable<{ success: true; id: number; created: boolean; message: string }> {
    return this.http.post<{ success: true; id: number; created: boolean; message: string }>(
      `${this.base}/reports/import-skipped`,
      {
        supplier_id: supplierId,
        payload: item.payload,
      },
    );
  }
}
