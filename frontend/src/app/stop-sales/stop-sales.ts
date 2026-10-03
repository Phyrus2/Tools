import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, of, switchMap } from 'rxjs';
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
      const key = String(action.product_id || action.product_name.trim().toLowerCase());
      groups.set(key, [...(groups.get(key) || []), action]);
    }
    return [...groups.entries()].map(([key, actions]) => ({
      key,
      label: actions[0].product_name,
      status: [...new Set(actions.map((action) => action.restriction_status))].join(' / '),
      actions,
    }));
  }

  get extractionWarnings(): string[] {
    const extraction = this.detail?.comparison.extraction;
    if (!extraction) return [];
    return [
      ...extraction.warnings,
      ...(extraction.current?.warnings || []),
      ...(extraction.baseline?.warnings || []).map((warning) => `Baseline: ${warning}`),
    ];
  }

  /** Folder path below the configured scan root, e.g. "Paradisus by Melia Bali". */
  supplierFolder(item: { parent_path?: string | null; base_path?: string | null; year?: number | null; source_year?: number | null; target_folder?: string | null }): string {
    const clean = (value: unknown) => String(value ?? '').replace(/\//g, '\\').replace(/\\+$/, '').trim();
    const parent = clean(item.parent_path);
    const root = [clean(item.base_path), item.year ?? item.source_year, clean(item.target_folder)]
      .filter((part) => part !== '' && part !== null && part !== undefined).join('\\');
    const relative = root && parent.toLowerCase().startsWith(root.toLowerCase()) ? parent.slice(root.length) : '';
    const parts = relative.split('\\').filter(Boolean);
    if (parts.length) return parts.join(' / ');
    return parent.split('\\').filter(Boolean).pop() || '-';
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
    if (result.job_id) return;
    this.clearFeedback();
    this.busy = true;
    this.api.createJob(result.id).pipe(finalize(() => { this.busy = false; this.render(); })).subscribe({
      next: (response) => {
        // Mark it locally so the button is disabled without re-running the scan.
        result.job_id = response.job_id;
        result.job_status = result.job_status || 'NEW';
        this.message = 'File ditambahkan ke Stop Sale Queue.';
        this.loadJobs();
      },
      error: (error) => this.fail(error),
    });
  }

  removeResult(result: StopSaleScanResult): void {
    if (result.job_id && result.job_status !== 'COMPLETED') return;
    if (!window.confirm(`Hapus "${result.file_name}" dari hasil scan?\nFile di drive tidak ikut terhapus.`)) return;
    this.run(this.api.removeScanResult(result.id), 'File dihapus dari hasil scan.', () => {
      this.results = this.results.filter((item) => item.id !== result.id);
    });
  }

  removeJob(job: StopSaleJob): void {
    if (!window.confirm(`Hapus "${job.file_name}"${job.company_name ? ` (${job.company_name})` : ''} dari Pending Queue?`)) return;
    this.run(this.api.deleteJob(job.id), 'Job dihapus dari Pending Queue.', () => {
      this.jobs = this.jobs.filter((item) => item.id !== job.id);
      // The file can be added to the queue again from the scan results.
      for (const result of this.results) if (result.job_id === job.id) { result.job_id = null; result.job_status = null; }
      if (this.detail?.job.id === job.id) this.closeJob();
    });
  }

  resultAction(result: StopSaleScanResult): string {
    if (result.job_status === 'COMPLETED') return 'Completed';
    return result.job_id ? 'In queue' : 'Add to queue';
  }

  /** Supplier part of the folder name, without the "- updated on 02 Oct" note. */
  supplierName(item: Parameters<StopSales['supplierFolder']>[0]): string {
    return this.supplierFolder(item).split(' / ')[0].replace(/\s*-\s*updated\b.*$/i, '').trim() || '-';
  }

  private groupBySupplier<T extends Parameters<StopSales['supplierFolder']>[0]>(items: T[]): { key: string; name: string; folder: string; items: T[] }[] {
    const groups = new Map<string, { key: string; name: string; folder: string; items: T[] }>();
    for (const item of items) {
      const name = this.supplierName(item);
      const key = name.toLowerCase();
      const group = groups.get(key);
      if (group) group.items.push(item);
      else groups.set(key, { key, name, folder: this.supplierFolder(item), items: [item] });
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get resultGroups() {
    return this.groupBySupplier(this.results);
  }

  get queueGroups() {
    return this.groupBySupplier(this.queueJobs);
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
        this.supplierQuery = detail.job.company_name || this.folderSupplierGuess(detail.job);
        if (!detail.job.supplier_id && this.supplierQuery && this.supplierQuery !== '-') this.searchSuppliers();
        this.showDefaultMonth(detail);
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
        this.showDefaultMonth(detail);
        this.message = 'File Stop Sale berhasil di-upload. Preview stop sale sudah tampil di kalender.';
      },
      error: (error) => this.fail(error),
    });
  }

  processJob(): void {
    if (!this.detail?.job.supplier_id) {
      this.error = 'Pilih supplier terlebih dahulu.';
      return;
    }
    if (!this.detail.job.source_mode) {
      this.error = 'File hasil scan tidak bisa diakses. Upload file Stop Sale secara manual.';
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
        const changes = detail.comparison.actions.filter((action) => action.change === 'ADDED' || action.change === 'REMOVED');
        this.showDefaultMonth(detail);
        this.message = !detail.baseline
          ? 'File pertama diproses tanpa baseline: stop sale ditampilkan sebagai kondisi saat ini.'
          : changes.length
            ? `Ditemukan ${changes.length} perubahan stop sale dibanding baseline.`
            : 'Tidak ada perubahan stop sale dibanding baseline.';
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

  /**
   * Folder names look like "PARADISUS BY MELIA BALI - updated on 02 Oct"; drop the update note.
   * "K CLUB & KANVA UBUD" names two hotels: suggest the one in the file name
   * ("K CLUB UBUD Update ...") for the first job and the other one for an added job.
   */
  private folderSupplierGuess(job: StopSaleJob): string {
    const folder = this.supplierFolder(job).split(' / ')[0].replace(/\s*-\s*updated\b.*$/i, '').trim();
    const parts = folder.split(/\s*&\s*/).filter(Boolean);
    if (parts.length < 2) return folder;
    const fileName = (job.file_name || '').toLowerCase();
    const inFile = (part: string) => part.toLowerCase().split(/\s+/).filter((word) => word.length > 2 && word !== 'the')
      .some((word) => fileName.includes(word));
    const ordered = [...parts.filter(inFile), ...parts.filter((part) => !inFile(part))];
    return ordered[Math.min(job.split_index || 0, ordered.length - 1)];
  }

  /** Queue the same file again for another supplier (one file covering two hotels). */
  addSupplier(): void {
    if (!this.detail) return;
    const job = this.detail.job;
    this.clearFeedback();
    this.busy = true;
    const saveCurrent = job.supplier_id
      ? this.api.updateJob(job.id, { supplier_id: job.supplier_id, document_type: job.document_type, note: job.note })
      : of(null);
    saveCurrent.pipe(
      switchMap(() => this.api.addSupplierJob(job.id)),
      finalize(() => { this.busy = false; this.render(); }),
    ).subscribe({
      next: (response) => {
        this.loadJobs();
        this.openJob({ ...job, id: response.job_id, supplier_id: null, company_name: null });
        this.message = 'File yang sama ditambahkan untuk supplier lain. Pilih suppliernya lalu Compare.';
      },
      error: (error) => this.fail(error),
    });
  }

  useScanFile(): void {
    if (!this.detail) return;
    const id = this.detail.job.id;
    this.clearFeedback();
    this.busy = true;
    this.api.clearUpload(id).pipe(
      switchMap(() => this.api.getJob(id)),
      finalize(() => { this.busy = false; this.render(); }),
    ).subscribe({
      next: (detail) => {
        this.detail = detail;
        this.showDefaultMonth(detail);
        this.message = 'Kembali memakai file hasil scan.';
      },
      error: (error) => this.fail(error),
    });
  }

  /** Open the calendar on the month the supplier updated the file, else the first change. */
  private showDefaultMonth(detail: StopSaleDetail): void {
    const firstChange = detail.comparison.actions.find((action) => action.change === 'ADDED' || action.change === 'REMOVED');
    const firstDate = detail.job.update_date
      || (firstChange || detail.comparison.actions[0])?.start_date || detail.items[0]?.start_date;
    if (firstDate) this.calendarMonth = firstDate.slice(0, 7);
  }

  /** Days before the update date have passed (suppliers black/grey them out); not a stop sale. */
  isPast(date: string): boolean {
    const updated = this.detail?.job.update_date;
    return Boolean(updated && date < updated);
  }

  private actionAt(row: { actions: StopSaleAction[] }, date: string): StopSaleAction | undefined {
    const actions = row.actions.filter((action) => action.start_date <= date && action.end_date >= date);
    for (const change of ['ADDED', 'REMOVED', 'UPDATED', 'UNCHANGED', 'CURRENT']) {
      const action = actions.find((candidate) => candidate.change === change);
      if (action) return action;
    }
    return undefined;
  }

  calendarState(row: { actions: StopSaleAction[] }, date: string): string {
    if (this.isPast(date)) return 'past';
    const action = this.actionAt(row, date);
    if (!action) return '';
    const state = action.change.toLowerCase();
    return action.restriction_status === 'ON_REQUEST' ? `${state} request` : state;
  }

  calendarCode(row: { actions: StopSaleAction[] }, date: string): string {
    if (this.isPast(date)) return '';
    const action = this.actionAt(row, date);
    if (!action) return '';
    return action.restriction_status === 'ON_REQUEST' ? 'R' : 'C';
  }

  calendarTitle(row: { actions: StopSaleAction[] }, date: string): string {
    if (this.isPast(date)) return `Sudah lewat (file di-update ${this.detail?.job.update_date})`;
    const action = this.actionAt(row, date);
    if (!action) return 'Open';
    const labels: Record<string, string> = {
      ADDED: 'New stop sale',
      REMOVED: 'Re-opened / no longer restricted',
      UNCHANGED: 'Unchanged',
      CURRENT: 'In this file',
      UPDATED: 'Changed',
    };
    return `${labels[action.change] || action.change} · ${action.restriction_status.replace('_', ' ')}`;
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
