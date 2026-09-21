import { AnalyticsGranularity, AnalyticsSeriesPoint } from '../services/performance-analytics';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type ChartType = 'bar' | 'line' | 'table';

export function completePeriods(dateFrom: string, dateTo: string, granularity: AnalyticsGranularity, points: AnalyticsSeriesPoint[]): AnalyticsSeriesPoint[] {
  const values = new Map(points.map((point) => [point.period, point.bookings]));
  const start = new Date(`${granularity === 'year' ? dateFrom.slice(0, 4) + '-01-01' : granularity === 'month' ? dateFrom.slice(0, 7) + '-01' : dateFrom}T00:00:00Z`);
  const end = new Date(`${granularity === 'year' ? dateTo.slice(0, 4) + '-01-01' : granularity === 'month' ? dateTo.slice(0, 7) + '-01' : dateTo}T00:00:00Z`);
  const multipleYears = dateFrom.slice(0, 4) !== dateTo.slice(0, 4);
  const result: AnalyticsSeriesPoint[] = [];
  for (const cursor = new Date(start); cursor <= end; advance(cursor, granularity)) {
    const period = granularity === 'year'
      ? String(cursor.getUTCFullYear())
      : granularity === 'month'
        ? `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`
        : cursor.toISOString().slice(0, 10);
    const month = MONTHS[cursor.getUTCMonth()];
    const label = granularity === 'year'
      ? period
      : granularity === 'month'
        ? (multipleYears ? `${month} ${String(cursor.getUTCFullYear()).slice(2)}` : month)
        : `${cursor.getUTCDate()} ${month}${multipleYears ? ` ${String(cursor.getUTCFullYear()).slice(2)}` : ''}`;
    result.push({ period, label, bookings: values.get(period) || 0 });
  }
  return result;
}

function advance(date: Date, granularity: AnalyticsGranularity): void {
  if (granularity === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else if (granularity === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCDate(date.getUTCDate() + 1);
}

export function linePoints(values: number[]): string {
  const max = Math.max(...values, 1);
  const width = 1000;
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = 195 - (value / max) * 170;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

export function linePointX(index: number, total: number): number {
  return total <= 1 ? 500 : (index / (total - 1)) * 1000;
}

export function linePointY(value: number, values: number[]): number {
  const max = Math.max(...values, 1);
  return 195 - (value / max) * 170;
}

export function periodDateRange(period: string, granularity: AnalyticsGranularity): { dateFrom: string; dateTo: string } {
  if (granularity === 'year') return { dateFrom: `${period}-01-01`, dateTo: `${period}-12-31` };
  if (granularity === 'day') return { dateFrom: period, dateTo: period };
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    dateFrom: `${period}-01`,
    dateTo: `${period}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function barHeight(value: number, values: number[]): number {
  const max = Math.max(...values, 0);
  return max ? Math.max(3, Math.round((value / max) * 100)) : 3;
}

export function locationLabel(...parts: (string | null)[]): string {
  return parts.filter(Boolean).join(', ') || 'Location unavailable';
}
