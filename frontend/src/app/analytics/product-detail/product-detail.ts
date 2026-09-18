import { CommonModule, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { DatePicker } from '../../shared/date-picker/date-picker';
import { barHeight, ChartType, completePeriods, linePoints, linePointX, linePointY, locationLabel, periodDateRange, WEEKDAYS } from '../analytics-base';
import { AnalyticsGranularity, PerformanceAnalyticsService, ProductAnalytics } from '../../services/performance-analytics';

@Component({ selector: 'app-product-detail', imports: [CommonModule, FormsModule, RouterLink, DatePicker], templateUrl: './product-detail.html', styleUrls: ['../analytics.scss', './product-detail.scss'], changeDetection: ChangeDetectionStrategy.OnPush })
export class ProductDetail implements OnInit, OnDestroy {
  data?: ProductAnalytics; dateFrom = ''; dateTo = ''; chartType: ChartType = 'bar'; loading = true; errorMessage = ''; readonly weekdays = WEEKDAYS;
  backLabel = 'Kembali ke halaman sebelumnya';
  private backTarget = '/catalog-search';
  granularity: AnalyticsGranularity = 'month';
  drillHistory: { dateFrom: string; dateTo: string; granularity: AnalyticsGranularity }[] = [];
  readonly bookingPageSize = 10;
  bookingPage = 1;
  editingRecord = false;
  savingRecord = false;
  recordMessage = '';
  recordError = '';
  productForm = { supplier_id: 0, name: '', type: '', status: 'Regular Product', info: '', not_on_offer: '', services_included: '', services_excluded: '', instructions: '', description: '' };
  private request?: Subscription; private productId = 0;
  constructor(private readonly route: ActivatedRoute, private readonly analytics: PerformanceAnalyticsService, private readonly cdr: ChangeDetectorRef, private readonly browserLocation: Location, private readonly router: Router) {}
  ngOnInit(): void { const state = this.browserLocation.getState() as { backLabel?: string; returnTo?: string }; this.backLabel = state.backLabel || this.backLabel; this.backTarget = state.returnTo || this.backTarget; this.productId = Number(this.route.snapshot.paramMap.get('id')); this.load(); }
  ngOnDestroy(): void { this.request?.unsubscribe(); }
  load(dateFrom?: string, dateTo?: string, granularity: AnalyticsGranularity = this.granularity): void { this.request?.unsubscribe(); this.loading = true; this.errorMessage = ''; this.request = this.analytics.product(this.productId, dateFrom, dateTo, granularity).subscribe({ next: (data) => { this.data = { ...data, monthly: completePeriods(data.dateFrom, data.dateTo, data.granularity, data.monthly) }; this.syncProductForm(data.product); this.dateFrom = data.dateFrom; this.dateTo = data.dateTo; this.granularity = data.granularity; this.bookingPage = 1; this.loading = false; this.cdr.markForCheck(); }, error: (error: HttpErrorResponse) => { this.errorMessage = error.error?.message || 'Analytics product gagal dimuat.'; this.loading = false; this.cdr.markForCheck(); } }); }
  applyRange(): void { this.drillHistory = []; this.load(this.dateFrom, this.dateTo); }
  setGranularity(value: AnalyticsGranularity): void { this.drillHistory = []; this.load(this.dateFrom, this.dateTo, value); }
  selectPeriod(period: string): void { this.drillHistory.push({ dateFrom: this.dateFrom, dateTo: this.dateTo, granularity: this.granularity }); const range = periodDateRange(period, this.granularity); const next = this.granularity === 'year' ? 'month' : 'day'; this.load(range.dateFrom, range.dateTo, next); }
  drillBack(): void { const previous = this.drillHistory.pop(); if (previous) this.load(previous.dateFrom, previous.dateTo, previous.granularity); }
  monthHeight(value: number): number { return barHeight(value, this.data?.monthly.map((point) => point.bookings) || []); }
  weekdayHeight(value: number): number { return barHeight(value, this.data?.weekdays.map((point) => point.bookings) || []); }
  monthPoints(): string { return linePoints(this.data?.monthly.map((point) => point.bookings) || []); }
  monthPointX(index: number): number { return linePointX(index, this.data?.monthly.length || 0); }
  monthPointY(value: number): number { return linePointY(value, this.data?.monthly.map((point) => point.bookings) || []); }
  weekdayPoints(): string { return linePoints(this.weekdays.map((_day, index) => this.weekdayValue(index))); }
  location(): string { const p = this.data?.product; return p ? locationLabel(p.location, p.town, p.region) : ''; }
  weekdayValue(index: number): number { return this.data?.weekdays.find((point) => point.weekday === index)?.bookings || 0; }
  get bookingPages(): number { return Math.max(1, Math.ceil((this.data?.bookedProducts.length || 0) / this.bookingPageSize)); }
  get visibleBookings(): ProductAnalytics['bookedProducts'] { const start = (this.bookingPage - 1) * this.bookingPageSize; return this.data?.bookedProducts.slice(start, start + this.bookingPageSize) || []; }
  previousBookingPage(): void { if (this.bookingPage > 1) this.bookingPage--; }
  nextBookingPage(): void { if (this.bookingPage < this.bookingPages) this.bookingPage++; }
  durationLabel(row: ProductAnalytics['bookedProducts'][number]): string { return row.duration && row.duration_unit ? `${row.duration}${row.duration_unit}` : '-'; }
  goBack(): void { const state = this.browserLocation.getState() as { navigationId?: number }; if ((state.navigationId || 0) > 1) { this.browserLocation.back(); return; } void this.router.navigateByUrl(this.backTarget); }
  startRecordEdit(): void { if (!this.data) return; this.syncProductForm(this.data.product); this.recordMessage = ''; this.recordError = ''; this.editingRecord = true; }
  cancelRecordEdit(): void { if (this.data) this.syncProductForm(this.data.product); this.editingRecord = false; this.recordError = ''; }
  saveRecord(): void { if (!this.data || this.savingRecord) return; this.savingRecord = true; this.recordError = ''; this.recordMessage = ''; this.analytics.updateProduct(this.productId, this.productForm).subscribe({ next: (response) => { if (this.data) this.data = { ...this.data, product: response.product }; this.syncProductForm(response.product); this.savingRecord = false; this.editingRecord = false; this.recordMessage = response.message; this.cdr.markForCheck(); }, error: (error: HttpErrorResponse) => { this.savingRecord = false; this.recordError = error.error?.message || 'Data product gagal disimpan.'; this.cdr.markForCheck(); } }); }
  private syncProductForm(product: ProductAnalytics['product']): void { this.productForm = { supplier_id: product.supplier_id, name: product.name, type: product.type || '', status: product.status, info: product.info || '', not_on_offer: product.not_on_offer || '', services_included: product.services_included || '', services_excluded: product.services_excluded || '', instructions: product.instructions || '', description: product.description || '' }; }
}
