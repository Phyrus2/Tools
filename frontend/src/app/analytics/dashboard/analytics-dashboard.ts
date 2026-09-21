import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { DatePicker } from '../../shared/date-picker/date-picker';
import { barHeight, ChartType, completePeriods, linePoints, linePointX, linePointY, periodDateRange } from '../analytics-base';
import { AnalyticsGranularity, OverviewAnalytics, PerformanceAnalyticsService } from '../../services/performance-analytics';

@Component({
  selector: 'app-analytics-dashboard',
  imports: [CommonModule, FormsModule, RouterLink, DatePicker],
  templateUrl: './analytics-dashboard.html',
  styleUrls: ['../analytics.scss', './analytics-dashboard.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsDashboard implements OnInit, OnDestroy {
  readonly destinationColors = ['#315f50', '#d29b3a', '#8e6246'];
  data?: OverviewAnalytics;
  loading = true;
  errorMessage = '';
  dateFrom = '';
  dateTo = '';
  chartType: ChartType = 'bar';
  granularity: AnalyticsGranularity = 'month';
  showAllSales = false;
  showAllOperational = false;
  drillHistory: { dateFrom: string; dateTo: string; granularity: AnalyticsGranularity }[] = [];
  private request?: Subscription;

  constructor(private readonly analytics: PerformanceAnalyticsService, private readonly cdr: ChangeDetectorRef) {}
  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void { this.request?.unsubscribe(); }

  load(dateFrom?: string, dateTo?: string, granularity: AnalyticsGranularity = this.granularity): void {
    this.request?.unsubscribe(); this.loading = true; this.errorMessage = '';
    this.request = this.analytics.overview(dateFrom, dateTo, granularity).subscribe({
      next: (data) => { this.data = { ...data, monthly: completePeriods(data.dateFrom, data.dateTo, data.granularity, data.monthly) }; this.dateFrom = data.dateFrom; this.dateTo = data.dateTo; this.granularity = data.granularity; this.loading = false; this.cdr.markForCheck(); },
      error: (_error: HttpErrorResponse) => { this.errorMessage = 'Unable to load the dashboard.'; this.loading = false; this.cdr.markForCheck(); },
    });
  }
  applyRange(): void { this.drillHistory = []; this.load(this.dateFrom, this.dateTo); }
  setGranularity(value: AnalyticsGranularity): void { this.drillHistory = []; this.load(this.dateFrom, this.dateTo, value); }
  selectPeriod(period: string): void { this.drillHistory.push({ dateFrom: this.dateFrom, dateTo: this.dateTo, granularity: this.granularity }); const range = periodDateRange(period, this.granularity); const next = this.granularity === 'year' ? 'month' : 'day'; this.load(range.dateFrom, range.dateTo, next); }
  drillBack(): void { const previous = this.drillHistory.pop(); if (previous) this.load(previous.dateFrom, previous.dateTo, previous.granularity); }
  height(value: number): number { return barHeight(value, this.data?.monthly.map((point) => point.bookings) || []); }
  points(): string { return linePoints(this.data?.monthly.map((point) => point.bookings) || []); }
  pointX(index: number): number { return linePointX(index, this.data?.monthly.length || 0); }
  pointY(value: number): number { return linePointY(value, this.data?.monthly.map((point) => point.bookings) || []); }
  destinationTotal(): number { return this.data?.topTransferDestinations.reduce((total, row) => total + row.bookings, 0) || 0; }
  destinationPercent(bookings: number): number { const total = this.destinationTotal(); return total ? Math.round((bookings / total) * 100) : 0; }
  destinationGradient(): string {
    const rows = this.data?.topTransferDestinations || [];
    const total = this.destinationTotal();
    if (!total) return 'conic-gradient(#e7e1d5 0 100%)';
    let cursor = 0;
    const stops = rows.map((row, index) => {
      const start = cursor;
      cursor += (row.bookings / total) * 100;
      return `${this.destinationColors[index % this.destinationColors.length]} ${start}% ${cursor}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }
  get visibleSales() { return this.showAllSales ? (this.data?.topSales || []) : (this.data?.topSales || []).slice(0, 3); }
  get visibleOperational() { return this.showAllOperational ? (this.data?.topOperational || []) : (this.data?.topOperational || []).slice(0, 3); }
}
