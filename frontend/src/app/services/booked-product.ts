import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
 
export interface BookedProductRow {
  row: number;
  id: number;
  dossier_id: string | null;
  dossier_name: string | null;
  supplier_id: number;
  product_id: number;
  product_name: string;
  status: string | null;
  travel_date: string | null;
  price: number | null;
  changes?: BookedProductChange[];
}
 
export interface BookedProductChange {
  field: string;
  old: any;
  new: any;
}
 
export interface UnchangedBookedProduct {
  row: number;
  id: number;
  dossier_id: string | null;
  dossier_name: string | null;
  product_name: string;
}
 
export interface SkippedBookedProduct {
  row: number;
  reason: string;
  supplier_name?: string | null;
  product_name?: string | null;
  can_add_product?: boolean;
  manual_data?: {
    booked_product_id: number | null;
    original_product_id: number | null;
    dossier_id: string | null;
    dossier_name: string | null;
    supplier_id: number | null;
    product_name: string | null;
    product_type: string | null;
    booking_status: string | null;
    code: string | null;
    duration: number | null;
    travel_date: string | null;
    end_date: string | null;
    sales: string | null;
    operational: string | null;
    quantity: number | null;
    unit: string | null;
    price: number | null;
    description: string | null;
    info: string | null;
    instructions: string | null;
    transport_pickup: string | null;
    transport_dropoff: string | null;
  };
}

export interface ManualBookedProductPayload {
  sourceRow: number;
  idMode: 'manual' | 'random';
  productId: number | null;
  supplierId: number | null;
  productName: string;
  productType: string;
  productStatus: 'One Time Product' | 'Regular Product';
  booking: {
    bookedProductId: number | null;
    dossierId: string;
    dossierName: string;
    status: string;
    code: string;
    duration: number | null;
    travelDate: string;
    endDate: string;
    sales: string;
    operational: string;
    quantity: number | null;
    unit: string;
    price: number | null;
    description: string;
    info: string;
    instructions: string;
    transportPickup: string;
    transportDropoff: string;
  };
}

export interface BookedProductImportStatus {
  fileName: string;
  totalRows: number;
  importedAt: string;
}
 
export interface BookedProductImportResult {
  success: boolean;
  message: string;
  lastImport: BookedProductImportStatus | null;
 
  summary: {
    totalRows: number;
    inserted: number;
    updated: number;
    unchanged: number;
    skipped: number;
  };
 
  insertedRows: BookedProductRow[];
  updatedRows: BookedProductRow[];
  unchangedRows: UnchangedBookedProduct[];
  skippedRows: SkippedBookedProduct[];
}
 
@Injectable({
  providedIn: 'root',
})

export class BookedProduct {
  private apiUrl = 'https://weekly-gdp-colours-leonard.trycloudflare.com';
 
  constructor(private http: HttpClient) {}
 
  importBookedProduct(file: File): Observable<BookedProductImportResult> {
    const formData = new FormData();
    formData.append('file', file);
 
    return this.http.post<BookedProductImportResult>(
      `${this.apiUrl}/booked-product/import`,
      formData,
    );
  }

  getImportStatus(): Observable<{
    success: boolean;
    lastImport: BookedProductImportStatus | null;
  }> {
    return this.http.get<{
      success: boolean;
      lastImport: BookedProductImportStatus | null;
    }>(`${this.apiUrl}/booked-product/import/status`);
  }

  createManualProduct(payload: ManualBookedProductPayload): Observable<{
    success: boolean;
    message: string;
    productId: number;
    bookedProduct: BookedProductRow;
  }> {
    return this.http.post<{
      success: boolean;
      message: string;
      productId: number;
      bookedProduct: BookedProductRow;
    }>(`${this.apiUrl}/booked-product/manual`, payload);
  }
}
