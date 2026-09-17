import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './api-config';

export interface AnalyticsSeriesPoint { period: string; label: string; bookings: number; }
export interface AnalyticsWeekdayPoint { weekday: number; bookings: number; }
export type AnalyticsGranularity = 'day' | 'month' | 'year';

export interface OverviewAnalytics {
  success: true;
  timezone: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  granularity: AnalyticsGranularity;
  summary: { bookedProducts: number; reservations: number; suppliers: number; products: number; };
  monthly: AnalyticsSeriesPoint[];
  topSuppliers: { supplier_id: number; company_name: string; bookings: number; }[];
  topProducts: { product_id: number; name: string; company_name: string; bookings: number; }[];
  topTransferDestinations: { destination: string; bookings: number; }[];
  multiServiceDossiers: {
    dossier_id: string; dossier_name: string | null; booked_products: number; travel_days: number;
    first_travel_date: string; last_travel_date: string;
    orders: { sold_product_id: number; travel_date: string; product_name: string; supplier_name: string; }[];
  }[];
}

export interface SupplierAnalytics {
  success: true;
  timezone: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  granularity: AnalyticsGranularity;
  supplier: {
    supplier_id: number; company_name: string; address: string | null; town: string | null;
    region: string | null; location: string | null; category_supplier: string[]; status: string;
  };
  summary: {
    bookedProducts: number; reservations: number; bookedProductTypes: number;
    totalProducts: number; lastTravelDate: string | null;
  };
  monthly: AnalyticsSeriesPoint[];
  products: {
    product_id: number; name: string; type: string | null; status: string;
    not_on_offer: string | null; bookings: number; reservations: number;
    last_travel_date: string | null; contribution: number;
  }[];
}

export interface ProductAnalytics {
  success: true;
  timezone: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  granularity: AnalyticsGranularity;
  product: {
    product_id: number; name: string; type: string | null; status: string;
    not_on_offer: string | null; description: string | null; supplier_id: number;
    company_name: string; location: string | null; town: string | null; region: string | null;
  };
  summary: {
    bookedProducts: number; reservations: number; supplierRank: number | null;
    firstTravelDate: string | null; lastTravelDate: string | null;
  };
  monthly: AnalyticsSeriesPoint[];
  weekdays: AnalyticsWeekdayPoint[];
}

@Injectable({ providedIn: 'root' })
export class PerformanceAnalyticsService {
  constructor(private readonly http: HttpClient) {}

  overview(dateFrom?: string, dateTo?: string, granularity: AnalyticsGranularity = 'month'): Observable<OverviewAnalytics> {
    return this.http.get<OverviewAnalytics>(`${API_URL}/analytics/overview`, { params: this.dateParams(dateFrom, dateTo, granularity) });
  }

  supplier(id: number, dateFrom?: string, dateTo?: string, granularity: AnalyticsGranularity = 'month'): Observable<SupplierAnalytics> {
    return this.http.get<SupplierAnalytics>(`${API_URL}/analytics/suppliers/${id}`, { params: this.dateParams(dateFrom, dateTo, granularity) });
  }

  product(id: number, dateFrom?: string, dateTo?: string, granularity: AnalyticsGranularity = 'month'): Observable<ProductAnalytics> {
    return this.http.get<ProductAnalytics>(`${API_URL}/analytics/products/${id}`, { params: this.dateParams(dateFrom, dateTo, granularity) });
  }

  private dateParams(dateFrom?: string, dateTo?: string, granularity: AnalyticsGranularity = 'month'): HttpParams {
    let params = new HttpParams().set('granularity', granularity);
    if (dateFrom) params = params.set('dateFrom', dateFrom);
    if (dateTo) params = params.set('dateTo', dateTo);
    return params;
  }
}
