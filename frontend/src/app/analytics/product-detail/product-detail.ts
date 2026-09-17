import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { DatePicker } from '../../shared/date-picker/date-picker';
import { barHeight, ChartType, completePeriods, linePoints, linePointX, linePointY, locationLabel, periodDateRange, WEEKDAYS } from '../analytics-base';
import { AnalyticsGranularity, PerformanceAnalyticsService, ProductAnalytics } from '../../services/performance-analytics';

@Component({ selector: 'app-product-detail', imports: [CommonModule, FormsModule, RouterLink, DatePicker], templateUrl: './product-detail.html', styleUrl: '../analytics.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class ProductDetail implements OnInit, OnDestroy {
  data?: ProductAnalytics; dateFrom = ''; dateTo = ''; chartType: ChartType = 'bar'; loading = true; errorMessage = ''; readonly weekdays = WEEKDAYS;
  granularity: AnalyticsGranularity = 'month';
  drillHistory: { dateFrom: string; dateTo: string; granularity: AnalyticsGranularity }[] = [];
  private request?: Subscription; private productId = 0;
  constructor(private readonly route: ActivatedRoute, private readonly analytics: PerformanceAnalyticsService, private readonly cdr: ChangeDetectorRef) {}
  ngOnInit(): void { this.productId = Number(this.route.snapshot.paramMap.get('id')); this.load(); }
  ngOnDestroy(): void { this.request?.unsubscribe(); }
  load(dateFrom?: string, dateTo?: string, granularity: AnalyticsGranularity = this.granularity): void { this.request?.unsubscribe(); this.loading = true; this.errorMessage = ''; this.request = this.analytics.product(this.productId, dateFrom, dateTo, granularity).subscribe({ next: (data) => { this.data = { ...data, monthly: completePeriods(data.dateFrom, data.dateTo, data.granularity, data.monthly) }; this.dateFrom = data.dateFrom; this.dateTo = data.dateTo; this.granularity = data.granularity; this.loading = false; this.cdr.markForCheck(); }, error: (error: HttpErrorResponse) => { this.errorMessage = error.error?.message || 'Analytics product gagal dimuat.'; this.loading = false; this.cdr.markForCheck(); } }); }
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
}
