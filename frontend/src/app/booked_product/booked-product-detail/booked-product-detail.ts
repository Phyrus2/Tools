import { CommonModule, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { BookedProductRecord, PerformanceAnalyticsService } from '../../services/performance-analytics';

interface TransportDetailForm {
  date: string;
  time: string;
  locality: string;
  location: string;
  text: string;
}

type EditableBookedProduct = Omit<BookedProductRecord, 'id' | 'created_at' | 'updated_at' | 'company_name' | 'master_product_name' | 'transport_pickup' | 'transport_dropoff'> & {
  transport_pickup: TransportDetailForm;
  transport_dropoff: TransportDetailForm;
};

@Component({
  selector: 'app-booked-product-detail',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './booked-product-detail.html',
  styleUrls: ['../../analytics/analytics.scss', './booked-product-detail.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookedProductDetail implements OnInit, OnDestroy {
  data?: BookedProductRecord;
  bookedForm?: EditableBookedProduct;
  loading = true;
  editing = false;
  saving = false;
  errorMessage = '';
  feedbackMessage = '';
  backLabel = 'Kembali ke halaman sebelumnya';
  private backTarget = '/search';
  private bookedProductId = 0;
  private request?: Subscription;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly records: PerformanceAnalyticsService,
    private readonly cdr: ChangeDetectorRef,
    private readonly browserLocation: Location,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    const state = this.browserLocation.getState() as { backLabel?: string; returnTo?: string };
    this.backLabel = state.backLabel || this.backLabel;
    this.backTarget = state.returnTo || this.backTarget;
    this.bookedProductId = Number(this.route.snapshot.paramMap.get('id'));
    this.load();
  }

  ngOnDestroy(): void { this.request?.unsubscribe(); }

  load(): void {
    this.loading = true;
    this.errorMessage = '';
    this.request?.unsubscribe();
    this.request = this.records.bookedProduct(this.bookedProductId).subscribe({
      next: (response) => {
        this.data = response.bookedProduct;
        this.syncForm(response.bookedProduct);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.loading = false;
        this.errorMessage = error.error?.message || 'Detail booked product gagal dimuat.';
        this.cdr.markForCheck();
      },
    });
  }

  startEdit(): void {
    if (!this.data) return;
    this.syncForm(this.data);
    this.feedbackMessage = '';
    this.errorMessage = '';
    this.editing = true;
  }

  cancelEdit(): void {
    if (this.data) this.syncForm(this.data);
    this.editing = false;
    this.errorMessage = '';
  }

  save(): void {
    if (!this.bookedForm || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.feedbackMessage = '';
    this.records.updateBookedProduct(this.bookedProductId, this.bookedForm).subscribe({
      next: (response) => {
        this.data = response.bookedProduct;
        this.syncForm(response.bookedProduct);
        this.saving = false;
        this.editing = false;
        this.feedbackMessage = 'Booked product berhasil diperbarui.';
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.saving = false;
        this.errorMessage = error.error?.message || 'Booked product gagal disimpan.';
        this.cdr.markForCheck();
      },
    });
  }

  goBack(): void {
    const state = this.browserLocation.getState() as { navigationId?: number };
    if ((state.navigationId || 0) > 1) {
      this.browserLocation.back();
      return;
    }
    void this.router.navigateByUrl(this.backTarget);
  }

  private syncForm(record: BookedProductRecord): void {
    this.bookedForm = {
      dossier_id: record.dossier_id,
      dossier_name: record.dossier_name,
      supplier_id: record.supplier_id,
      product_id: record.product_id,
      product_name: record.product_name,
      status: record.status,
      code: record.code,
      duration: record.duration,
      duration_unit: record.duration_unit,
      travel_date: this.dateInput(record.travel_date),
      end_date: this.dateInput(record.end_date),
      sales: record.sales,
      operational: record.operational,
      quantity: record.quantity,
      unit: record.unit,
      price: record.price,
      description: record.description,
      info: record.info,
      instructions: record.instructions,
      transport_pickup: this.transportForm(record.transport_pickup),
      transport_dropoff: this.transportForm(record.transport_dropoff),
    };
  }

  private dateInput(value: string | null): string | null { return value ? String(value).slice(0, 10) : null; }
  private transportForm(value: unknown): TransportDetailForm {
    let parsed: Record<string, unknown> = {};
    if (value && typeof value === 'object') parsed = value as Record<string, unknown>;
    if (typeof value === 'string') {
      try { parsed = JSON.parse(value) as Record<string, unknown>; } catch { parsed = { text: value }; }
    }
    return {
      date: String(parsed['date'] || ''),
      time: String(parsed['time'] || ''),
      locality: String(parsed['locality'] || ''),
      location: String(parsed['location'] || ''),
      text: String(parsed['text'] || ''),
    };
  }
}
