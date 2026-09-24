import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, forkJoin, switchMap } from 'rxjs';
import { CatalogSearchService, SupplierSearchResult } from '../services/catalog-search';
import { DatePicker } from '../shared/date-picker/date-picker';
import { TimePicker } from '../shared/time-picker/time-picker';
import {
  ContractMonitoringService,
  ContractImportItem,
  ContractImportResult,
  ContractReport,
  GroupRecommendation,
  ManagementGroup,
  PendingItem,
  PendingFileItem,
  PendingQueueGroup,
  PendingSupplierGroup,
  PendingSupplier,
  ScanResult,
  ScanResultAnalysis,
  ScanRun,
  ScanSource,
  SignedStatus,
  SupplierRecommendation,
} from '../services/contract-monitoring';

type WorkspaceTab = 'scan' | 'queue' | 'reports' | 'settings';

interface SourceForm {
  server_id: string;
  year: number;
  base_path: string;
  target_folder: string;
  module_key: 'CONTRACT' | 'QUOTE_TICKET';
  enabled: boolean;
}

const ACTIVE_SCAN_KEY = 'contract-monitoring-active-scan';

@Component({
  selector: 'app-contract-monitoring',
  imports: [CommonModule, FormsModule, RouterLink, DatePicker, TimePicker],
  templateUrl: './contract-monitoring.html',
  styleUrl: './contract-monitoring.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractMonitoring implements OnInit, OnDestroy {
  tab: WorkspaceTab = 'scan';
  busy = false;
  error = '';
  message = '';

  sources: ScanSource[] = [];
  serverId = 'office';
  sourceForm: SourceForm = this.emptySourceForm();
  showSourceForm = false;

  scanMode: 'AUTO' | 'CUSTOM' = 'CUSTOM';
  scanStartDate = this.witaParts(new Date(Date.now() - 24 * 60 * 60 * 1000)).date;
  scanStartTime = this.witaParts(new Date(Date.now() - 24 * 60 * 60 * 1000)).time;
  scanEndDate = this.witaParts(new Date()).date;
  scanEndTime = this.witaParts(new Date()).time;
  currentScan: ScanRun | null = null;
  results: ScanResult[] = [];

  queue: PendingQueueGroup[] = [];
  queuePage = 1;
  readonly queuePageSize = 8;
  queueTotal = 0;
  queueLoading = false;
  pendingImportFile: File | null = null;
  queueStatus: string[] = [];
  queueCategory: string[] = [];
  queueSupplierStatus: string[] = [];
  queueCategories: string[] = [];
  groups: ManagementGroup[] = [];
  reports: ContractReport[] = [];
  reportRegionGroups: {
    name: string;
    locations: { name: string; reports: ContractReport[] }[];
  }[] = [];
  reportPage = 1;
  readonly reportPageSize = 100;
  reportTotal = 0;
  reportStatus: string[] = [];
  reportCategory: string[] = [];
  reportExpiryDate = '';
  reportRegion: string[] = [];
  reportLocation: string[] = [];
  reportSupplier = '';
  reportFilterOptions: { region: string; location: string }[] = [];
  reportCategories: string[] = [];
  reportImportFile: File | null = null;
  reportImportResult: ContractImportResult | null = null;
  reportReviewSection: 'NEW' | 'UPDATED' | 'UNCHANGED' | 'SKIPPED' | null = null;
  reportReviewPage = 1;
  readonly reportReviewPageSize = 25;
  reportManualItem: ContractImportItem | null = null;
  reportManualQuery = '';
  reportManualResults: SupplierSearchResult[] = [];
  reportManualSupplier: SupplierSearchResult | null = null;

  analysis: ScanResultAnalysis | null = null;
  pending: PendingItem | null = null;
  manualKeyword = '';
  manualResults: SupplierSearchResult[] = [];
  newGroupName = '';

  private pollHandle: ReturnType<typeof setTimeout> | null = null;
  private queueRequestId = 0;
  private readonly collapsedQueueGroups = new Set<string>();
  private readonly knownQueueManagementGroups = new Set<string>();
  readonly queueMetaSaving = new Set<number>();

  constructor(
    private readonly api: ContractMonitoringService,
    private readonly catalog: CatalogSearchService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadSources();
    this.loadQueue();
    this.loadGroups();
    this.loadReports();
    const activeId = Number.parseInt(sessionStorage.getItem(ACTIVE_SCAN_KEY) || '', 10);
    if (Number.isInteger(activeId) && activeId > 0) this.refreshScan(activeId);
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  selectTab(tab: WorkspaceTab): void {
    this.tab = tab;
    this.clearFeedback();
    if (tab === 'queue') this.loadQueue();
    if (tab === 'reports') this.loadReports();
    if (tab === 'settings') this.loadSources();
  }

  loadSources(): void {
    this.api.listSources().subscribe({
      next: (response) => {
        this.sources = response.sources;
        this.serverId = response.server_id;
        this.sourceForm.server_id = response.server_id;
        this.render();
      },
      error: (error) => this.fail(error),
    });
  }

  saveSource(): void {
    this.clearFeedback();
    this.busy = true;
    this.api
      .createSource(this.sourceForm)
      .pipe(
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: () => {
          this.message = 'Scan folder added successfully.';
          this.sourceForm = this.emptySourceForm();
          this.sourceForm.server_id = this.serverId;
          this.showSourceForm = false;
          this.loadSources();
        },
        error: (error) => this.fail(error),
      });
  }

  toggleSource(source: ScanSource): void {
    this.api
      .updateSource(source.id, {
        server_id: source.server_id,
        year: source.year,
        base_path: source.base_path,
        target_folder: source.target_folder,
        module_key: source.module_key,
        enabled: !Boolean(source.enabled),
      })
      .subscribe({ next: () => this.loadSources(), error: (error) => this.fail(error) });
  }

  deleteSource(source: ScanSource): void {
    if (
      !window.confirm(
        `Delete the "${source.target_folder}" configuration? The physical folder and its files will not be deleted.`,
      )
    )
      return;
    this.clearFeedback();
    this.busy = true;
    this.api
      .deleteSource(source.id)
      .pipe(
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: (response) => {
          this.message = 'Folder configuration deleted successfully.';
          this.loadSources();
        },
        error: (error) => this.fail(error),
      });
  }

  startScan(): void {
    this.clearFeedback();
    if (
      !this.sources.some(
        (source) => Boolean(source.enabled) && source.module_key !== 'INFO_STOP_SALES',
      )
    ) {
      this.error = 'Add at least one active scan folder first.';
      this.tab = 'settings';
      return;
    }
    this.busy = true;
    const body =
      this.scanMode === 'CUSTOM'
        ? {
            mode: this.scanMode,
            start: `${this.scanStartDate}T${this.scanStartTime}`,
            end: `${this.scanEndDate}T${this.scanEndTime}`,
          }
        : { mode: this.scanMode };
    this.api
      .startScan(body)
      .pipe(
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: (response) => {
          sessionStorage.setItem(ACTIVE_SCAN_KEY, String(response.scan_id));
          this.message = 'Scan started. Progress will refresh automatically.';
          this.refreshScan(response.scan_id);
        },
        error: (error) => this.fail(error),
      });
  }

  refreshScan(id = this.currentScan?.id): void {
    if (!id) return;
    this.api.getScan(id).subscribe({
      next: (response) => {
        this.currentScan = response.scan;
        if (['QUEUED', 'RUNNING'].includes(response.scan.status)) {
          this.stopPolling();
          this.pollHandle = setTimeout(() => this.refreshScan(id), 2000);
        } else {
          this.stopPolling();
          this.loadResults();
          this.loadSources();
        }
        this.render();
      },
      error: (error) => {
        this.stopPolling();
        this.fail(error);
      },
    });
  }

  loadResults(): void {
    if (!this.currentScan) return;
    this.api.getResults(this.currentScan.id).subscribe({
      next: (response) => {
        this.results = response.results;
        this.render();
      },
      error: (error) => this.fail(error),
    });
  }

  openResult(result: ScanResult): void {
    this.clearFeedback();
    this.busy = true;
    forkJoin({
      analysis: this.api.analyzeResult(result.id),
      claim: this.api.claimResult(result.id),
    })
      .pipe(
        switchMap(({ analysis, claim }) => {
          this.analysis = analysis;
          return this.api.getPending(claim.pending_id);
        }),
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: (response) => {
          this.pending = response.pending;
        },
        error: (error) => this.fail(error),
      });
  }

  openPending(id: number): void {
    this.clearFeedback();
    this.tab = 'scan';
    const queueSupplier = this.queue
      .flatMap((group) => group.suppliers)
      .find((supplier) => supplier.files.some((item) => item.id === id));
    const queueFile = queueSupplier?.files.find((item) => item.id === id);
    if (!queueFile) {
      this.error = 'The pending item was not found in the queue. Refresh the page and try again.';
      return;
    }
    this.busy = true;
    this.api
      .claimResult(queueFile.scan_result_id)
      .pipe(
        switchMap(() => this.api.startPending(id)),
        switchMap(() => this.api.getPending(id)),
        switchMap((pendingResponse) => {
          this.pending = pendingResponse.pending;
          return this.api.analyzeResult(pendingResponse.pending.scan_result_id);
        }),
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: (analysis) => {
          this.analysis = analysis;
        },
        error: (error) => this.fail(error),
      });
  }

  closeEditor(release = false): void {
    if (release && this.pending && ['NEW', 'IN_PROGRESS'].includes(this.pending.status)) {
      this.api
        .releasePending(this.pending.id)
        .subscribe({ next: () => this.loadQueue(), error: () => undefined });
    }
    this.pending = null;
    this.analysis = null;
    this.manualResults = [];
    this.newGroupName = '';
    this.loadResults();
  }

  addRecommendation(candidate: SupplierRecommendation): void {
    this.addSupplier({
      supplier_id: candidate.id,
      company_name: candidate.name,
      category_supplier: candidate.category_supplier,
      source: 'FUZZY',
      score: candidate.score,
      location: candidate.location,
    });
  }

  searchSupplier(): void {
    if (this.manualKeyword.trim().length < 2) {
      this.error = 'Enter at least 2 characters to search for a supplier.';
      return;
    }
    this.catalog.searchSuppliers(this.manualKeyword, '', 'active', 1, 10).subscribe({
      next: (response) => {
        this.manualResults = response.results;
        this.render();
      },
      error: (error) => this.fail(error),
    });
  }

  addManualSupplier(supplier: SupplierSearchResult): void {
    this.addSupplier({
      supplier_id: supplier.supplier_id,
      company_name: supplier.company_name,
      category_supplier: supplier.category_supplier,
      source: 'MANUAL',
      score: null,
      location: supplier.location,
    });
    this.manualResults = [];
    this.manualKeyword = '';
  }

  removeSupplier(index: number): void {
    if (!this.pending) return;
    this.pending.suppliers.splice(index, 1);
  }

  confirmSuppliers(): void {
    if (!this.pending?.suppliers.length) {
      this.error = 'Select a supplier first.';
      return;
    }
    this.clearFeedback();
    this.busy = true;
    const pendingId = this.pending.id;
    this.api
      .savePendingSuppliers(pendingId, this.pending.suppliers)
      .pipe(
        switchMap(() => this.api.releasePending(pendingId)),
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: () => {
          this.pending = null;
          this.analysis = null;
          this.message = 'Supplier confirmed. The file is now in the Pending Queue.';
          this.tab = 'queue';
          this.loadQueue();
          this.loadResults();
        },
        error: (error) => this.fail(error),
      });
  }

  queueWithoutSupplier(): void {
    if (!this.pending || this.pending.suppliers.length) return;
    this.clearFeedback();
    this.busy = true;
    const pendingId = this.pending.id;
    this.api
      .queueUnmatched(pendingId)
      .pipe(
        switchMap(() => this.api.releasePending(pendingId)),
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: () => {
          this.pending = null;
          this.analysis = null;
          this.message =
            'Supplier was not found in Jambix. The item was added to the Pending Queue.';
          this.tab = 'queue';
          this.loadQueue();
          this.loadResults();
        },
        error: (error) => this.fail(error),
      });
  }

  saveDraft(showMessage = true): void {
    if (!this.pending) return;
    this.clearFeedback();
    this.busy = true;
    this.api
      .savePendingSuppliers(this.pending.id, this.pending.suppliers)
      .pipe(
        switchMap(() => this.api.getPending(this.pending!.id)),
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: (response) => {
          this.pending = response.pending;
          if (showMessage) this.message = 'Supplier and contract draft saved successfully.';
        },
        error: (error) => this.fail(error),
      });
  }

  changeManagementMode(): void {
    if (!this.pending) return;
    const isManagement = Boolean(this.pending.is_management_contract);
    if (isManagement && !this.pending.management_name) {
      this.pending.management_name = this.folderName(this.pending.parent_path);
    }
    const retainedSupplierId = !isManagement ? this.pending.suppliers[0]?.supplier_id : null;
    this.busy = true;
    this.api
      .updatePending(this.pending.id, {
        is_management_contract: isManagement,
        management_group_id: isManagement ? this.pending.management_group_id : null,
        management_name: isManagement ? this.pending.management_name : null,
        prefill_group_members: true,
      })
      .pipe(
        switchMap(() => this.api.getPending(this.pending!.id)),
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: (response) => {
          this.pending = response.pending;
          if (!isManagement && retainedSupplierId) {
            this.pending.suppliers = this.pending.suppliers.filter(
              (supplier) => supplier.supplier_id === retainedSupplierId,
            );
            this.message =
              'Standard contract mode is active; only the first supplier was retained.';
          }
        },
        error: (error) => this.fail(error),
      });
  }

  chooseSuggestedGroup(group: GroupRecommendation): void {
    if (!this.pending) return;
    this.pending.is_management_contract = true;
    this.pending.management_group_id = group.id;
    this.changeManagementMode();
  }

  createGroupFromSelection(): void {
    if (!this.pending || !this.newGroupName.trim() || !this.pending.suppliers.length) {
      this.error = 'Enter a group name and select at least one supplier.';
      return;
    }
    const supplierIds = this.pending.suppliers
      .map((item) => item.supplier_id)
      .filter((supplierId): supplierId is number => supplierId !== null);
    if (supplierIds.length !== this.pending.suppliers.length) {
      this.error = 'Assign every supplier in Jambix before creating a management group.';
      return;
    }
    this.busy = true;
    this.api
      .createGroup(this.newGroupName.trim(), supplierIds)
      .pipe(
        switchMap((response) => {
          this.pending!.is_management_contract = true;
          this.pending!.management_group_id = response.id;
          return this.api.updatePending(this.pending!.id, {
            is_management_contract: true,
            management_group_id: response.id,
            prefill_group_members: true,
          });
        }),
        switchMap(() => this.api.getPending(this.pending!.id)),
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: (response) => {
          this.pending = response.pending;
          this.newGroupName = '';
          this.message = 'Management group saved successfully.';
          this.loadGroups();
        },
        error: (error) => this.fail(error),
      });
  }

  completePending(): void {
    if (!this.pending) return;
    this.clearFeedback();
    this.busy = true;
    this.api
      .savePendingSuppliers(this.pending.id, this.pending.suppliers)
      .pipe(
        switchMap(() => this.api.getPending(this.pending!.id)),
        switchMap((response) => {
          this.pending = response.pending;
          return this.api.completePending(response.pending.id, response.pending.version);
        }),
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: () => {
          this.message = 'Contract saved to the report successfully.';
          this.pending = null;
          this.analysis = null;
          this.tab = 'queue';
          this.loadResults();
          this.loadQueue();
          this.loadReports();
        },
        error: (error) => this.fail(error),
      });
  }

  ignoreCurrent(): void {
    if (!this.pending) return;
    const reason = this.pending.note?.trim();
    if (!reason) {
      this.error = 'Enter a note explaining why the file is being ignored.';
      return;
    }
    this.busy = true;
    this.api
      .ignorePending(this.pending.id, reason)
      .pipe(
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: () => {
          this.message = 'The file was marked as ignored.';
          this.pending = null;
          this.analysis = null;
          this.tab = 'queue';
          this.loadResults();
          this.loadQueue();
        },
        error: (error) => this.fail(error),
      });
  }

  loadQueue(resetPage = false): void {
    if (resetPage) this.queuePage = 1;
    const requestId = ++this.queueRequestId;
    this.queueLoading = true;
    this.api
      .listPending(
        {
          status: this.queueStatus,
          category: this.queueCategory,
          supplier_status: this.queueSupplierStatus,
        },
        this.queuePage,
        this.queuePageSize,
      )
      .pipe(
        finalize(() => {
          if (requestId !== this.queueRequestId) return;
          this.queueLoading = false;
          this.render();
        }),
      )
      .subscribe({
        next: (response) => {
          if (requestId !== this.queueRequestId) return;
          this.queueTotal = response.total;
          if (this.queuePage > this.queueTotalPages) {
            this.queuePage = this.queueTotalPages;
            this.loadQueue();
            return;
          }
          this.queue = response.pending;
          for (const group of this.queue) {
            if (!group.is_management || this.knownQueueManagementGroups.has(group.key)) continue;
            this.knownQueueManagementGroups.add(group.key);
            this.collapsedQueueGroups.add(group.key);
          }
          this.queueCategories = [
            ...new Set([...this.queueCategories, ...response.categories]),
          ].sort();
          this.render();
        },
        error: (error) => {
          if (requestId === this.queueRequestId) this.fail(error);
        },
      });
  }

  selectPendingImport(event: Event): void {
    this.pendingImportFile = (event.target as HTMLInputElement).files?.[0] || null;
  }

  importPendingExcel(): void {
    if (!this.pendingImportFile || this.busy) return;
    this.clearFeedback();
    this.busy = true;
    this.api
      .importPending(this.pendingImportFile)
      .pipe(
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: (response) => {
          this.message = `Pending Queue import completed: ${response.summary.inserted} added, ${response.summary.skipped} skipped.`;
          this.pendingImportFile = null;
          this.loadQueue(true);
        },
        error: (error) => this.fail(error),
      });
  }

  get queueTotalPages(): number {
    return Math.max(1, Math.ceil(this.queueTotal / this.queuePageSize));
  }

  changeQueuePage(page: number): void {
    const nextPage = Math.min(Math.max(1, page), this.queueTotalPages);
    if (nextPage === this.queuePage) return;
    this.queuePage = nextPage;
    this.loadQueue();
  }

  isQueueGroupCollapsed(key: string): boolean {
    return this.collapsedQueueGroups.has(key);
  }

  toggleQueueGroup(key: string): void {
    if (this.collapsedQueueGroups.has(key)) this.collapsedQueueGroups.delete(key);
    else this.collapsedQueueGroups.add(key);
    this.render();
  }

  saveQueueMeta(item: PendingFileItem): void {
    if (this.queueMetaSaving.has(item.id)) return;
    this.queueMetaSaving.add(item.id);
    this.api
      .updateQueueMeta(item.id, item.workflow_state, item.note)
      .pipe(
        finalize(() => {
          this.queueMetaSaving.delete(item.id);
          this.render();
        }),
      )
      .subscribe({
        next: (response) => {
          this.message = response.message;
          this.render();
        },
        error: (error) => this.fail(error),
      });
  }

  queueSupplierNumber(groupIndex: number, supplierIndex: number): number {
    return (
      this.queue.slice(0, groupIndex).reduce((total, group) => total + group.suppliers.length, 0) +
      supplierIndex +
      1
    );
  }

  queueContractLabel(supplier: PendingSupplierGroup): string {
    return [
      ...new Set(supplier.files.map((item) => item.contract_period || String(item.year))),
    ].join(', ');
  }

  changeContractAction(supplier: PendingSupplier): void {
    if (supplier.action === 'UPDATE' && supplier.active_contracts.length) {
      supplier.target_contract_report_id ??= supplier.active_contracts[0].id;
      this.prefillContractUpdate(supplier);
      return;
    }
    if (supplier.action === 'INSERT') supplier.target_contract_report_id = null;
  }

  prefillContractUpdate(supplier: PendingSupplier): void {
    const contract = supplier.active_contracts.find(
      (item) => item.id === supplier.target_contract_report_id,
    );
    if (!contract) return;
    supplier.supplier_type = contract.supplier_type;
    supplier.location_jambix = contract.location_jambix;
    supplier.validity_start = contract.validity_start;
    supplier.validity_end = contract.validity_end;
    supplier.contract_reference = contract.contract_reference;
    supplier.signed_status = contract.signed_status;
    supplier.note = contract.note;
    this.render();
  }

  loadGroups(): void {
    this.api.listGroups().subscribe({
      next: (response) => {
        this.groups = response.groups;
        this.render();
      },
      error: (error) => this.fail(error),
    });
  }

  loadReports(resetPage = false): void {
    if (resetPage) this.reportPage = 1;
    this.api
      .listReports(
        {
          status: this.reportStatus,
          category: this.reportCategory,
          expiry_date: this.reportExpiryDate,
          region: this.reportRegion,
          location: this.reportLocation,
          supplier: this.reportSupplier,
        },
        this.reportPage,
        this.reportPageSize,
      )
      .subscribe({
        next: (response) => {
          this.reports = response.reports;
          this.reportTotal = response.total;
          this.reportRegionGroups = this.groupReports(response.reports);
          this.reportFilterOptions = response.filter_options;
          this.reportCategories = [
            ...new Set([
              ...this.reportCategories,
              ...response.categories,
              ...response.reports.flatMap((report) => report.category_supplier || []),
            ]),
          ].sort();
          this.render();
        },
        error: (error) => this.fail(error),
      });
  }

  get reportTotalPages(): number {
    return Math.max(1, Math.ceil(this.reportTotal / this.reportPageSize));
  }

  changeReportPage(page: number): void {
    const nextPage = Math.min(Math.max(1, page), this.reportTotalPages);
    if (nextPage === this.reportPage) return;
    this.reportPage = nextPage;
    this.loadReports();
  }

  clearReportFilters(): void {
    this.reportSupplier = '';
    this.reportStatus = [];
    this.reportCategory = [];
    this.reportExpiryDate = '';
    this.reportRegion = [];
    this.reportLocation = [];
    this.loadReports(true);
  }

  get reportRegionOptions(): string[] {
    return [...new Set(this.reportFilterOptions.map((item) => item.region))].sort();
  }
  get reportLocationOptions(): string[] {
    return [
      ...new Set(
        this.reportFilterOptions
          .filter((item) => !this.reportRegion.length || this.reportRegion.includes(item.region))
          .map((item) => item.location),
      ),
    ].sort();
  }
  toggleMultiFilter(
    target: string[],
    value: string,
    checked: boolean,
    reload: 'queue' | 'reports',
  ): void {
    const index = target.indexOf(value);
    if (checked && index < 0) target.push(value);
    if (!checked && index >= 0) target.splice(index, 1);
    if (reload === 'queue') this.loadQueue(true);
    else this.loadReports(true);
  }
  multiFilterLabel(values: string[], fallback: string): string {
    return values.length ? `${values.length} selected` : fallback;
  }
  get resultYearGroups(): {
    year: number;
    suppliers: { key: string; supplierName: string; result: ScanResult; updateCount: number }[];
  }[] {
    const years = new Map<number, ScanResult[]>();
    for (const result of this.results) {
      if (!years.has(result.year)) years.set(result.year, []);
      years.get(result.year)!.push(result);
    }
    return [...years.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, results]) => {
        const suppliers = new Map<
          string,
          { key: string; supplierName: string; result: ScanResult; updateCount: number }
        >();
        for (const result of results) {
          const supplierName = this.folderName(result.parent_path);
          const key = supplierName.toLocaleLowerCase();
          const current = suppliers.get(key);
          if (current) {
            current.updateCount += 1;
            if (current.result.processed && !result.processed) current.result = result;
          } else suppliers.set(key, { key, supplierName, result, updateCount: 1 });
        }
        return { year, suppliers: [...suppliers.values()] };
      });
  }
  get sourceYearGroups(): { year: number; sources: ScanSource[] }[] {
    const years = new Map<number, ScanSource[]>();
    for (const source of this.sources) {
      if (!years.has(source.year)) years.set(source.year, []);
      years.get(source.year)!.push(source);
    }
    return [...years.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, sources]) => ({ year, sources }));
  }
  get activeReportReviewItems(): ContractImportItem[] {
    if (!this.reportImportResult) return [];
    if (this.reportReviewSection === 'NEW') return this.reportImportResult.newRows;
    if (this.reportReviewSection === 'UPDATED') return this.reportImportResult.updatedRows;
    if (this.reportReviewSection === 'UNCHANGED') return this.reportImportResult.unchangedRows;
    return this.reportImportResult.skippedRows;
  }
  get activeReportReviewPageItems(): ContractImportItem[] {
    const start = (this.reportReviewPage - 1) * this.reportReviewPageSize;
    return this.activeReportReviewItems.slice(start, start + this.reportReviewPageSize);
  }
  get reportReviewTotalPages(): number {
    return Math.max(1, Math.ceil(this.activeReportReviewItems.length / this.reportReviewPageSize));
  }
  get reportReviewPageStart(): number {
    return this.activeReportReviewItems.length
      ? (this.reportReviewPage - 1) * this.reportReviewPageSize + 1
      : 0;
  }
  get reportReviewPageEnd(): number {
    return Math.min(
      this.reportReviewPage * this.reportReviewPageSize,
      this.activeReportReviewItems.length,
    );
  }
  openReportReview(section: 'NEW' | 'UPDATED' | 'UNCHANGED' | 'SKIPPED'): void {
    this.reportReviewSection = section;
    this.reportReviewPage = 1;
  }
  closeReportReview(): void {
    this.reportReviewSection = null;
  }
  resolveImportItem(item: ContractImportItem): void {
    if (item.can_link_supplier) this.openManualImport(item);
  }
  openManualImport(item: ContractImportItem): void {
    this.closeReportReview();
    this.reportManualItem = item;
    this.reportManualQuery = item.supplier_name || '';
    this.reportManualSupplier = null;
    this.reportManualResults = [];
    this.searchManualImportSuppliers();
  }
  closeManualImport(): void {
    this.reportManualItem = null;
    this.reportManualResults = [];
    this.reportManualSupplier = null;
  }
  searchManualImportSuppliers(): void {
    this.catalog.searchSuppliers(this.reportManualQuery, '', '', 1, 30).subscribe({
      next: (response) => {
        this.reportManualResults = response.results;
        this.render();
      },
      error: (error) => this.fail(error),
    });
  }
  submitManualImport(): void {
    if (!this.reportManualItem || !this.reportManualSupplier) {
      this.error = 'Select a supplier from the Jambix database.';
      return;
    }
    const item = this.reportManualItem;
    this.busy = true;
    this.api
      .addSkippedReport(item, this.reportManualSupplier.supplier_id)
      .pipe(
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: (response) => {
          this.message = response.message;
          if (this.reportImportResult) {
            this.reportImportResult.skippedRows = this.reportImportResult.skippedRows.filter(
              (review) => review !== item,
            );
            this.reportImportResult.summary.skipped = this.reportImportResult.skippedRows.length;
            const resolvedItem = {
              ...item,
              id: response.id,
              supplier_name: this.reportManualSupplier?.company_name || item.supplier_name,
            };
            if (response.created) {
              this.reportImportResult.summary.inserted += 1;
              this.reportImportResult.newRows.unshift(resolvedItem);
            } else {
              this.reportImportResult.summary.unchanged += 1;
              this.reportImportResult.unchangedRows.unshift(resolvedItem);
            }
          }
          this.closeManualImport();
          if (!this.activeReportReviewItems.length) this.closeReportReview();
          else if (this.reportReviewPage > this.reportReviewTotalPages)
            this.reportReviewPage = this.reportReviewTotalPages;
          this.loadReports();
        },
        error: (e) => this.fail(e),
      });
  }

  selectReportImport(event: Event): void {
    this.reportImportFile = (event.target as HTMLInputElement).files?.[0] || null;
  }

  importReportExcel(): void {
    if (!this.reportImportFile) {
      this.error = 'Select the contract report Excel file first.';
      return;
    }
    this.clearFeedback();
    this.busy = true;
    this.api
      .importReports(this.reportImportFile)
      .pipe(
        finalize(() => {
          this.busy = false;
          this.render();
        }),
      )
      .subscribe({
        next: (response) => {
          this.reportImportResult = response;
          this.reportReviewSection = null;
          this.message = `Import completed: ${response.summary.inserted} new, ${response.summary.updated} updated, ${response.summary.unchanged} unchanged, ${response.summary.skipped} skipped.`;
          this.loadReports();
        },
        error: (error) => this.fail(error),
      });
  }

  private groupReports(reports: ContractReport[]): {
    name: string;
    locations: { name: string; reports: ContractReport[] }[];
  }[] {
    const regions = new Map<string, Map<string, ContractReport[]>>();
    for (const report of reports) {
      const region = report.region || 'Other';
      const location = report.location_jambix || 'Unspecified location';
      if (!regions.has(region)) regions.set(region, new Map());
      const locations = regions.get(region)!;
      if (!locations.has(location)) locations.set(location, []);
      locations.get(location)!.push(report);
    }
    return [...regions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, locations]) => ({
        name,
        locations: [...locations.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([locationName, reports]) => ({ name: locationName, reports })),
      }));
  }

  trackBySupplierId(_index: number, supplier: SupplierSearchResult): number {
    return supplier.supplier_id;
  }

  trackByImportRow(_index: number, item: ContractImportItem): string {
    return `${item.sheet_name}:${item.row_number}`;
  }

  copyPath(path: string): void {
    navigator.clipboard.writeText(path).then(
      () => {
        this.message = 'Path copied. Paste it into Windows Explorer.';
        this.render();
      },
      () => {
        this.error = 'The browser denied clipboard access. Select and copy the path manually.';
        this.render();
      },
    );
  }

  statusLabel(value: string): string {
    return value.replaceAll('_', ' ');
  }

  dateLabel(value: string | null): string {
    if (!value) return '—';
    const date = String(value).slice(0, 10).split('-');
    return date.length === 3 ? `${date[2]}/${date[1]}/${date[0]}` : value;
  }

  scoreLabel(score: number | null): string {
    return score === null ? 'Manual' : `${Math.round(score * 100)}%`;
  }

  sourcePreview(): string {
    const base = this.sourceForm.base_path.replace(/[\\/]+$/, '');
    const target = this.sourceForm.target_folder.replace(/^[\\/]+/, '');
    return base && target
      ? `${base}\\${this.sourceForm.year}\\${target}`
      : 'Complete the base path, year, and target folder.';
  }

  utcLabel(value: string | null): string {
    if (!value) return '—';
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
    if (Number.isNaN(date.getTime())) return value;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Makassar',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(date)
      .replace(',', '');
    return `${parts} WITA`;
  }

  trackById(
    _index: number,
    item: { id?: number; supplier_id?: number | null; key?: string },
  ): number | string {
    return item.id || item.supplier_id || item.key || _index;
  }

  private addSupplier(input: {
    supplier_id: number;
    company_name: string;
    category_supplier: string[];
    source: 'FUZZY' | 'MANUAL';
    score: number | null;
    location: string | null;
  }): void {
    if (
      !this.pending ||
      this.pending.suppliers.some((item) => item.supplier_id === input.supplier_id)
    )
      return;
    const unresolvedIndex = this.pending.suppliers.findIndex((item) => !item.supplier_id);
    const unresolved = unresolvedIndex >= 0 ? this.pending.suppliers[unresolvedIndex] : null;
    if (
      !this.pending.is_management_contract &&
      this.pending.suppliers.length >= 1 &&
      unresolvedIndex < 0
    ) {
      this.error =
        'A standard contract can only have one supplier. Remove the current supplier before replacing it.';
      this.render();
      return;
    }
    const selected: PendingSupplier = {
      supplier_id: input.supplier_id,
      company_name: input.company_name,
      category_supplier: input.category_supplier,
      recommendation_source: input.source,
      match_score: input.score,
      detection: input.source === 'MANUAL' ? 'NO_MATCH' : 'SUPPLIER_MATCH',
      action: unresolved?.action || 'INSERT',
      target_contract_report_id: null,
      supplier_type: unresolved?.supplier_type || input.category_supplier[0] || null,
      location_jambix: unresolved?.location_jambix || input.location,
      supplier_location: input.location,
      validity_start: unresolved?.validity_start || null,
      validity_end: unresolved?.validity_end || null,
      contract_reference: unresolved?.contract_reference || null,
      signed_status: unresolved?.signed_status || this.pending.detected_signed_status,
      note: unresolved?.note || null,
      active_contracts: [],
    };
    if (unresolvedIndex >= 0) this.pending.suppliers.splice(unresolvedIndex, 1, selected);
    else this.pending.suppliers.push(selected);
  }

  private folderName(parentPath: string): string {
    return parentPath.split(/[\\/]/).filter(Boolean).pop() || 'Management contract';
  }

  private emptySourceForm(): SourceForm {
    return {
      server_id: this.serverId || 'office',
      year: new Date().getFullYear(),
      base_path: '',
      target_folder: '',
      module_key: 'CONTRACT',
      enabled: true,
    };
  }

  private witaParts(date: Date): { date: string; time: string } {
    const value = new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString();
    return { date: value.slice(0, 10), time: value.slice(11, 16) };
  }

  private stopPolling(): void {
    if (this.pollHandle) clearTimeout(this.pollHandle);
    this.pollHandle = null;
  }

  private clearFeedback(): void {
    this.error = '';
    this.message = '';
  }

  private fail(error: unknown): void {
    this.busy = false;
    this.error =
      error instanceof HttpErrorResponse
        ? String(error.error?.message || 'The request failed. Check the backend connection.')
        : 'An unexpected error occurred.';
    this.render();
  }

  private render(): void {
    this.cdr.markForCheck();
  }
}
