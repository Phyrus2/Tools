import { CommonModule, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { DatePicker } from '../../shared/date-picker/date-picker';
import { barHeight, ChartType, completePeriods, linePoints, linePointX, linePointY, locationLabel, periodDateRange } from '../analytics-base';
import { AnalyticsGranularity, PerformanceAnalyticsService, SupplierAnalytics } from '../../services/performance-analytics';

@Component({ selector: 'app-supplier-detail', imports: [CommonModule, FormsModule, RouterLink, DatePicker], templateUrl: './supplier-detail.html', styleUrls: ['../analytics.scss', './supplier-detail.scss'], changeDetection: ChangeDetectionStrategy.OnPush })
export class SupplierDetail implements OnInit, OnDestroy {
  data?: SupplierAnalytics; dateFrom = ''; dateTo = ''; chartType: ChartType = 'bar'; loading = true; errorMessage = '';
  backLabel = 'Back to previous page';
  private backTarget = '/catalog-search';
  granularity: AnalyticsGranularity = 'month';
  drillHistory: { dateFrom: string; dateTo: string; granularity: AnalyticsGranularity }[] = [];
  readonly productPageSize = 10;
  productPage = 1;
  editingRecord = false;
  savingRecord = false;
  recordMessage = '';
  recordError = '';
  supplierForm = { company_name: '', address: '', town: '', region: '', location: '', category_supplier: '', status: 'Active' };
  private request?: Subscription; private supplierId = 0;
  constructor(private readonly route: ActivatedRoute, private readonly analytics: PerformanceAnalyticsService, private readonly cdr: ChangeDetectorRef, private readonly browserLocation: Location, private readonly router: Router) {}
  ngOnInit(): void { const state = this.browserLocation.getState() as { backLabel?: string; returnTo?: string }; this.backLabel = state.backLabel || this.backLabel; this.backTarget = state.returnTo || this.backTarget; this.supplierId = Number(this.route.snapshot.paramMap.get('id')); this.load(); }
  ngOnDestroy(): void { this.request?.unsubscribe(); }
  load(dateFrom?: string, dateTo?: string, granularity: AnalyticsGranularity = this.granularity): void { this.request?.unsubscribe(); this.loading = true; this.errorMessage = ''; this.request = this.analytics.supplier(this.supplierId, dateFrom, dateTo, granularity).subscribe({ next: (data) => { this.data = { ...data, monthly: completePeriods(data.dateFrom, data.dateTo, data.granularity, data.monthly) }; this.syncSupplierForm(data.supplier); this.dateFrom = data.dateFrom; this.dateTo = data.dateTo; this.granularity = data.granularity; this.productPage = 1; this.loading = false; this.cdr.markForCheck(); }, error: (_error: HttpErrorResponse) => { this.errorMessage = 'Unable to load supplier analytics.'; this.loading = false; this.cdr.markForCheck(); } }); }
  applyRange(): void { this.drillHistory = []; this.load(this.dateFrom, this.dateTo); }
  setGranularity(value: AnalyticsGranularity): void { this.drillHistory = []; this.load(this.dateFrom, this.dateTo, value); }
  selectPeriod(period: string): void { this.drillHistory.push({ dateFrom: this.dateFrom, dateTo: this.dateTo, granularity: this.granularity }); const range = periodDateRange(period, this.granularity); const next = this.granularity === 'year' ? 'month' : 'day'; this.load(range.dateFrom, range.dateTo, next); }
  drillBack(): void { const previous = this.drillHistory.pop(); if (previous) this.load(previous.dateFrom, previous.dateTo, previous.granularity); }
  height(value: number): number { return barHeight(value, this.data?.monthly.map((point) => point.bookings) || []); }
  points(): string { return linePoints(this.data?.monthly.map((point) => point.bookings) || []); }
  pointX(index: number): number { return linePointX(index, this.data?.monthly.length || 0); }
  pointY(value: number): number { return linePointY(value, this.data?.monthly.map((point) => point.bookings) || []); }
  location(): string { const s = this.data?.supplier; return s ? locationLabel(s.location, s.town, s.region) : ''; }
  get productPages(): number { return Math.max(1, Math.ceil((this.data?.products.length || 0) / this.productPageSize)); }
  get visibleProducts(): SupplierAnalytics['products'] { const start = (this.productPage - 1) * this.productPageSize; return this.data?.products.slice(start, start + this.productPageSize) || []; }
  previousProductPage(): void { if (this.productPage > 1) this.productPage--; }
  nextProductPage(): void { if (this.productPage < this.productPages) this.productPage++; }
  goBack(): void { const state = this.browserLocation.getState() as { navigationId?: number }; if ((state.navigationId || 0) > 1) { this.browserLocation.back(); return; } void this.router.navigateByUrl(this.backTarget); }
  startRecordEdit(): void { const supplier = this.data?.supplier; if (!supplier) return; this.syncSupplierForm(supplier); this.recordMessage = ''; this.recordError = ''; this.editingRecord = true; }
  cancelRecordEdit(): void { if (this.data) this.syncSupplierForm(this.data.supplier); this.editingRecord = false; this.recordError = ''; }
  saveRecord(): void { if (!this.data || this.savingRecord) return; this.savingRecord = true; this.recordError = ''; this.recordMessage = ''; this.analytics.updateSupplier(this.supplierId, { ...this.supplierForm, category_supplier: this.supplierForm.category_supplier.split(',').map((item) => item.trim()).filter(Boolean) }).subscribe({ next: (response) => { if (this.data) this.data = { ...this.data, supplier: response.supplier }; this.savingRecord = false; this.editingRecord = false; this.recordMessage = 'Supplier data updated successfully.'; this.cdr.markForCheck(); }, error: (_error: HttpErrorResponse) => { this.savingRecord = false; this.recordError = 'Unable to save supplier data.'; this.cdr.markForCheck(); } }); }
  private syncSupplierForm(supplier: SupplierAnalytics['supplier']): void { this.supplierForm = { company_name: supplier.company_name, address: supplier.address || '', town: supplier.town || '', region: supplier.region || '', location: supplier.location || '', category_supplier: supplier.category_supplier.join(', '), status: supplier.status }; }
}
