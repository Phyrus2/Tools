import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { DatePicker } from '../../shared/date-picker/date-picker';
import { barHeight, ChartType, completePeriods, linePoints, linePointX, linePointY, locationLabel, periodDateRange } from '../analytics-base';
import { AnalyticsGranularity, PerformanceAnalyticsService, SupplierAnalytics } from '../../services/performance-analytics';

@Component({ selector: 'app-supplier-detail', imports: [CommonModule, FormsModule, RouterLink, DatePicker], templateUrl: './supplier-detail.html', styleUrl: '../analytics.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class SupplierDetail implements OnInit, OnDestroy {
  data?: SupplierAnalytics; dateFrom = ''; dateTo = ''; chartType: ChartType = 'bar'; loading = true; errorMessage = '';
  granularity: AnalyticsGranularity = 'month';
  drillHistory: { dateFrom: string; dateTo: string; granularity: AnalyticsGranularity }[] = [];
  readonly productPageSize = 10;
  productPage = 1;
  private request?: Subscription; private supplierId = 0;
  constructor(private readonly route: ActivatedRoute, private readonly analytics: PerformanceAnalyticsService, private readonly cdr: ChangeDetectorRef) {}
  ngOnInit(): void { this.supplierId = Number(this.route.snapshot.paramMap.get('id')); this.load(); }
  ngOnDestroy(): void { this.request?.unsubscribe(); }
  load(dateFrom?: string, dateTo?: string, granularity: AnalyticsGranularity = this.granularity): void { this.request?.unsubscribe(); this.loading = true; this.errorMessage = ''; this.request = this.analytics.supplier(this.supplierId, dateFrom, dateTo, granularity).subscribe({ next: (data) => { this.data = { ...data, monthly: completePeriods(data.dateFrom, data.dateTo, data.granularity, data.monthly) }; this.dateFrom = data.dateFrom; this.dateTo = data.dateTo; this.granularity = data.granularity; this.productPage = 1; this.loading = false; this.cdr.markForCheck(); }, error: (error: HttpErrorResponse) => { this.errorMessage = error.error?.message || 'Analytics supplier gagal dimuat.'; this.loading = false; this.cdr.markForCheck(); } }); }
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
}
