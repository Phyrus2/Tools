import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, switchMap } from 'rxjs';
import {
  StopSaleAction,
  StopSaleDetail,
  StopSaleJob,
  StopSaleReport,
  StopSaleScan,
  StopSaleScanResult,
  StopSaleSource,
  StopSaleSupplier,
  StopSalesService,
} from '../services/stop-sales';

type StopSaleTab = 'scan' | 'queue' | 'reports' | 'settings';

@Component({
  selector: 'app-stop-sales',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './stop-sales.html',
  styleUrl: './stop-sales.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StopSales implements OnInit, OnDestroy {
  tab: StopSaleTab = 'scan';
  busy = false;
  error = '';
  message = '';
  serverId = 'office';

  sources: StopSaleSource[] = [];
  sourceForm = { server_id: 'office', year: new Date().getFullYear(), base_path: '', target_folder: '', enabled: true };
  scanMode: 'AUTO' | 'CUSTOM' = 'CUSTOM';
  scanStart = this.localDateTime(new Date(Date.now() - 24 * 60 * 60 * 1000));
  scanEnd = this.localDateTime(new Date());
  currentScan: StopSaleScan | null = null;
  results: StopSaleScanResult[] = [];

  jobs: StopSaleJob[] = [];
  reports: StopSaleReport[] = [];
  detail: StopSaleDetail | null = null;
  supplierQuery = '';
  suppliers: StopSaleSupplier[] = [];
  pendingUploadFile: File | null = null;
  calendarMonth = this.localDate(new Date()).slice(0, 7);
  private pollHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly api: StopSalesService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadSources();
    this.loadJobs();
    this.loadReports();
  }

  ngOnDestroy(): void {
    if (this.pollHandle) clearTimeout(this.pollHandle);
  }

  get queueJobs(): StopSaleJob[] {
    return this.jobs.filter((job) => !job.is_active_baseline && job.status !== 'COMPLETED');
  }

  get calendarDays(): { date: string; day: number; weekday: string }[] {
    const [year, month] = this.calendarMonth.split('-').map(Number);
    if (!year || !month) return [];
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: count }, (_, index) => {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
      return {
        date,
        day: index + 1,
        weekday: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)),
      };
    });
  }

  get calendarRows(): { key: string; label: string; status: string; actions: StopSaleAction[] }[] {
    const groups = new Map<string, StopSaleAction[]>();
    for (const action of this.detail?.comparison.actions || []) {
      const key = `${action.product_id || action.product_name}|${action.restriction_status}`;
      groups.set(key, [...(groups.get(key) || []), action]);
    }
    return [...groups.entries()].map(([key, actions]) => ({
      key,
      label: actions[0].product_name,
      status: actions[0].restriction_status,
      actions,
    }));
  }

  selectTab(tab: StopSaleTab): void {
    this.tab = tab;
    this.detail = null;
    this.clearFeedback();
    if (tab === 'queue') this.loadJobs();
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

  createSource(): void {
    this.run(
      this.api.createSource(this.sourceForm),
      'Folder Stop Sale ditambahkan.',
      () => {
        this.sourceForm = { ...this.sourceForm, base_path: '', target_folder: '' };
        this.loadSources();
      },
    );
  }

  toggleSource(source: StopSaleSource): void {
    this.run(this.api.updateSource(source), 'Status folder diperbarui.', () => this.loadSources());
  }

  deleteSource(source: StopSaleSource): void {
    if (!window.confirm(`Hapus konfigurasi folder "${source.target_folder}"? File fisik tidak dihapus.`)) return;
    this.run(this.api.deleteSource(source.id), 'Konfigurasi folder dihapus.', () => this.loadSources());
  }

  startScan(): void {
    this.clearFeedback();
    this.busy = true;
    const body = this.scanMode === 'AUTO'
      ? { mode: 'AUTO' as const }
      : { mode: 'CUSTOM' as const, start: this.scanStart, end: this.scanEnd };
    this.api.startScan(body).pipe(finalize(() => { this.busy = false; this.render(); })).subscribe({
      next: (response) => {
        this.message = 'Scan Stop Sale dimulai.';
        this.refreshScan(response.scan_id);
      },
      error: (error) => this.fail(error),
    });
  }

  refreshScan(id: number): void {
    if (this.pollHandle) clearTimeout(this.pollHandle);
    this.api.getScan(id).subscribe({
      next: (response) => {
        this.currentScan = response.scan;
        if (['QUEUED', 'RUNNING'].includes(response.scan.status)) {
          this.pollHandle = setTimeout(() => this.refreshScan(id), 1500);
        } else {
          this.api.getResults(id).subscribe({
            next: (results) => { this.results = results.results; this.render(); },
            error: (error) => this.fail(error),
          });
        }
        this.render();
      },
      error: (error) => this.fail(error),
    });
  }

  addToQueue(result: StopSaleScanResult): void {
    this.run(this.api.createJob(result.id), 'File ditambahkan ke Stop Sale Queue.', () => {
      this.loadJobs();
      this.tab = 'queue';
    });
  }

  loadJobs(): void {
    this.api.listJobs().subscribe({
      next: (response) => { this.jobs = response.jobs; this.render(); },
      error: (error) => this.fail(error),
    });
  }

  openJob(job: StopSaleJob): void {
    this.clearFeedback();
    this.busy = true;
    this.api.getJob(job.id).pipe(finalize(() => { this.busy = false; this.render(); })).subscribe({
      next: (detail) => {
        this.detail = detail;
        this.pendingUploadFile = null;
        this.supplierQuery = detail.job.company_name || '';
        const firstDate = detail.comparison.actions[0]?.start_date || detail.items[0]?.start_date;
        if (firstDate) this.calendarMonth = firstDate.slice(0, 7);
      },
      error: (error) => this.fail(error),
    });
  }

  closeJob(): void {
    this.detail = null;
    this.suppliers = [];
    this.pendingUploadFile = null;
  }

  searchSuppliers(): void {
    this.api.searchSuppliers(this.supplierQuery).subscribe({
      next: (response) => { this.suppliers = response.suppliers; this.render(); },
      error: (error) => this.fail(error),
    });
  }

  chooseSupplier(supplier: StopSaleSupplier): void {
    if (!this.detail) return;
    this.detail.job.supplier_id = supplier.supplier_id;
    this.detail.job.company_name = supplier.company_name;
    this.supplierQuery = supplier.company_name;
    this.suppliers = [];
  }

  selectComparisonFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pendingUploadFile = input.files?.[0] || null;
  }

  uploadComparisonFile(): void {
    if (!this.detail || !this.pendingUploadFile) {
      this.error = 'Pilih file Stop Sale terlebih dahulu.';
      return;
    }
    const id = this.detail.job.id;
    this.clearFeedback();
    this.busy = true;
    this.api.uploadJobFile(id, this.pendingUploadFile).pipe(
      switchMap(() => this.api.getJob(id)),
      finalize(() => { this.busy = false; this.render(); }),
    ).subscribe({
      next: (detail) => {
        this.detail = detail;
        this.pendingUploadFile = null;
        this.message = 'File Stop Sale berhasil di-upload dan siap dibandingkan.';
      },
      error: (error) => this.fail(error),
    });
  }

  processJob(): void {
    if (!this.detail?.job.supplier_id) {
      this.error = 'Pilih supplier terlebih dahulu.';
      return;
    }
    if (!this.detail.job.uploaded_file_name) {
      this.error = 'Upload file Stop Sale sebelum menjalankan Compare.';
      return;
    }
    const job = this.detail.job;
    const supplierId = job.supplier_id;
    if (!supplierId) return;
    this.clearFeedback();
    this.busy = true;
    this.api.updateJob(job.id, {
      supplier_id: supplierId,
      document_type: job.document_type,
      note: job.note,
    }).pipe(
      switchMap(() => this.api.processJob(job.id)),
      switchMap(() => this.api.getJob(job.id)),
      finalize(() => { this.busy = false; this.render(); }),
    ).subscribe({
      next: (detail) => {
        this.detail = detail;
        const firstDate = detail.comparison.actions[0]?.start_date;
        if (firstDate) this.calendarMonth = firstDate.slice(0, 7);
        this.message = detail.baseline
          ? 'File dibandingkan dengan baseline aktif.'
          : 'File pertama diproses tanpa baseline.';
      },
      error: (error) => this.fail(error),
    });
  }

  completeJob(): void {
    if (!this.detail) return;
    if (!window.confirm('Pastikan semua perubahan sudah diinput pada Jambix. Complete sekarang?')) return;
    const id = this.detail.job.id;
    this.run(this.api.completeJob(id), 'Stop Sale selesai dan menjadi baseline aktif.', () => {
      this.closeJob();
      this.loadJobs();
      this.loadReports();
    });
  }

  loadReports(): void {
    this.api.listReports().subscribe({
      next: (response) => { this.reports = response.reports; this.render(); },
      error: (error) => this.fail(error),
    });
  }

  calendarState(row: { actions: StopSaleAction[] }, date: string): string {
    const actions = row.actions.filter((action) => action.start_date <= date && action.end_date >= date);
    if (actions.some((action) => action.change === 'ADDED')) return 'added';
    if (actions.some((action) => action.change === 'REMOVED')) return 'removed';
    if (actions.some((action) => action.change === 'UPDATED')) return 'updated';
    if (actions.some((action) => action.change === 'UNCHANGED')) return 'unchanged';
    return '';
  }

  calendarTitle(row: { actions: StopSaleAction[] }, date: string): string {
    const action = row.actions.find((candidate) => candidate.start_date <= date && candidate.end_date >= date);
    if (!action) return 'Available';
    return `${action.change} · ${action.restriction_status.replace('_', ' ')}`;
  }

  changeMonth(offset: number): void {
    const [year, month] = this.calendarMonth.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    this.calendarMonth = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  trackById(_: number, item: { id?: number }): number | undefined { return item.id; }
  trackByDate(_: number, item: { date: string }): string { return item.date; }
  trackByKey(_: number, item: { key: string }): string { return item.key; }

  private run(request: ReturnType<StopSalesService['deleteSource']>, message: string, next?: () => void): void {
    this.clearFeedback();
    this.busy = true;
    request.pipe(finalize(() => { this.busy = false; this.render(); })).subscribe({
      next: () => { this.message = message; next?.(); },
      error: (error) => this.fail(error),
    });
  }

  private fail(error: any): void {
    this.error = error?.error?.message || error?.message || 'Terjadi kesalahan.';
    this.busy = false;
    this.render();
  }

  private clearFeedback(): void { this.error = ''; this.message = ''; }
  private render(): void { this.cdr.markForCheck(); }
  private localDate(value: Date): string {
    const shifted = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 10);
  }
  private localDateTime(value: Date): string {
    const shifted = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 16);
  }
}
