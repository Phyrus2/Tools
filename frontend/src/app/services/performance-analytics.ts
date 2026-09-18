import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './api-config';

export interface AnalyticsSeriesPoint { period: string; label: string; bookings: number; }
export interface AnalyticsWeekdayPoint { weekday: number; bookings: number; }
export type AnalyticsGranularity = 'day' | 'month' | 'year';

export interface SupplierRecord {
  supplier_id: number; company_name: string; address: string | null; town: string | null;
  region: string | null; location: string | null; category_supplier: string[]; status: string;
  created_at: string; updated_at: string;
}

export interface ProductRecord {
  product_id: number; supplier_id: number; name: string; type: string | null; status: string;
  info: string | null; not_on_offer: string | null; services_included: string | null;
  services_excluded: string | null; instructions: string | null; description: string | null;
  created_at: string; updated_at: string; company_name: string; location: string | null;
  town: string | null; region: string | null;
}

export interface BookedProductRecord {
  id: number; dossier_id: string; dossier_name: string | null; supplier_id: number; product_id: number;
  product_name: string | null; status: string | null; code: string | null; duration: number | null;
  duration_unit: 'D' | 'N' | null; travel_date: string | null; end_date: string | null;
  sales: string | null; operational: string | null; quantity: number | null; unit: string | null;
  price: number | null; description: string | null; info: string | null; instructions: string | null;
  transport_pickup: unknown; transport_dropoff: unknown; created_at: string; updated_at: string;
  company_name: string; master_product_name: string;
}

export interface OverviewAnalytics {
  success: true;
  timezone: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  granularity: AnalyticsGranularity;
  summary: {
    bookedProducts: number; totalBookings: number; reservations: number; suppliers: number; products: number;
    totalDossiers: number; totalSuppliers: number; totalProducts: number;
  };
  monthly: AnalyticsSeriesPoint[];
  topSuppliers: { supplier_id: number; company_name: string; bookings: number; }[];
  topProducts: { product_id: number; name: string; company_name: string; bookings: number; }[];
  topSales: { name: string; bookings: number; }[];
  topOperational: { name: string; bookings: number; }[];
  topTransferDestinations: { destination: string; bookings: number; }[];
}

export interface SupplierAnalytics {
  success: true;
  timezone: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  granularity: AnalyticsGranularity;
  supplier: SupplierRecord;
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
  product: ProductRecord;
  summary: {
    bookedProducts: number; reservations: number; supplierRank: number | null;
    firstTravelDate: string | null; lastTravelDate: string | null;
  };
  monthly: AnalyticsSeriesPoint[];
  weekdays: AnalyticsWeekdayPoint[];
  bookedProducts: {
    sold_product_id: number; dossier_id: string | null; dossier_name: string | null;
    travel_date: string; end_date: string | null; duration: number | null;
    duration_unit: 'N' | 'D' | null; quantity: number | null; unit: string | null;
    total_quantity: number | null; sales: string | null; operational: string | null;
  }[];
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

  updateSupplier(id: number, supplier: Omit<SupplierRecord, 'supplier_id' | 'created_at' | 'updated_at'>): Observable<{ success: true; message: string; supplier: SupplierRecord }> {
    return this.http.patch<{ success: true; message: string; supplier: SupplierRecord }>(`${API_URL}/analytics/suppliers/${id}`, supplier);
  }

  updateProduct(id: number, product: Omit<ProductRecord, 'product_id' | 'created_at' | 'updated_at' | 'company_name' | 'location' | 'town' | 'region'>): Observable<{ success: true; message: string; product: ProductRecord }> {
    return this.http.patch<{ success: true; message: string; product: ProductRecord }>(`${API_URL}/analytics/products/${id}`, product);
  }

  bookedProduct(id: number): Observable<{ success: true; bookedProduct: BookedProductRecord }> {
    return this.http.get<{ success: true; bookedProduct: BookedProductRecord }>(`${API_URL}/booked-product/${id}`);
  }

  updateBookedProduct(id: number, bookedProduct: Omit<BookedProductRecord, 'id' | 'created_at' | 'updated_at' | 'company_name' | 'master_product_name'>): Observable<{ success: true; bookedProduct: BookedProductRecord }> {
    return this.http.patch<{ success: true; bookedProduct: BookedProductRecord }>(`${API_URL}/booked-product/${id}`, bookedProduct);
  }

  private dateParams(dateFrom?: string, dateTo?: string, granularity: AnalyticsGranularity = 'month'): HttpParams {
    let params = new HttpParams().set('granularity', granularity);
    if (dateFrom) params = params.set('dateFrom', dateFrom);
    if (dateTo) params = params.set('dateTo', dateTo);
    return params;
  }
}
