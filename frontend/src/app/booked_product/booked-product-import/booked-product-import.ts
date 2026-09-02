import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { BookedProduct, BookedProductImportResult } from '../../services/booked-product';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

class Paginator<T> {
  page = 1;
  pageSize = 50;
  private all: T[] = [];
 
  setData(items: T[]) {
    this.all = items ?? [];
    this.page = 1;
  }
 
  get total(): number {
    return this.all.length;
  }
 
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }
 
  get pageItems(): T[] {
    const start = (this.page - 1) * this.pageSize;
    return this.all.slice(start, start + this.pageSize);
  }
 
  goTo(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.page = page;
  }
 
  next() {
    this.goTo(this.page + 1);
  }
 
  prev() {
    this.goTo(this.page - 1);
  }
}

@Component({
  selector: 'app-booked-product-import',
  imports: [CommonModule, FormsModule],
  templateUrl: './booked-product-import.html',
  styleUrl: './booked-product-import.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookedProductImport {
  selectedFile: File | null = null;
  loading = false;
  result: BookedProductImportResult | null = null;
  errorMessage = '';
 
  inserted =
    new Paginator<BookedProductImportResult['insertedRows'][number]>();
  updated =
    new Paginator<BookedProductImportResult['updatedRows'][number]>();
  unchanged =
    new Paginator<BookedProductImportResult['unchangedRows'][number]>();
  skipped =
    new Paginator<BookedProductImportResult['skippedRows'][number]>();
 
  constructor(
    private service: BookedProduct,
    private cdr: ChangeDetectorRef,
  ) {}
 
  // ==========================================
  // FILE SELECT
  // ==========================================
 
  onFileSelected(event: any) {
    const file = event.target.files?.[0];
 
    if (!file) {
      return;
    }
 
    this.selectedFile = file;
    this.errorMessage = '';
    this.result = null;
  }
 
  // ==========================================
  // IMPORT
  // ==========================================
 
  importBookedProduct() {
    this.errorMessage = '';
 
    if (!this.selectedFile) {
      this.errorMessage = 'Please select an Excel file.';
      return;
    }
 
    this.loading = true;
    this.cdr.markForCheck();
 
    this.service.importBookedProduct(this.selectedFile).subscribe({
      next: (response) => {
        this.loading = false;
 
        // Let the button repaint first, then assign the (possibly large)
        // result on the next tick so the UI doesn't look frozen while
        // Angular processes/paginates a large dataset.
        setTimeout(() => {
          this.result = response;
 
          this.inserted.setData(response.insertedRows);
          this.updated.setData(response.updatedRows);
          this.unchanged.setData(response.unchangedRows);
          this.skipped.setData(response.skippedRows);
 
          this.cdr.markForCheck();
        }, 0);
      },
 
      error: (error) => {
        this.loading = false;
        this.errorMessage = error.error?.message || 'Import failed.';
        this.cdr.markForCheck();
      },
    });
  }
 
  // ==========================================
  // RESET
  // ==========================================
 
  reset() {
    this.selectedFile = null;
    this.result = null;
    this.errorMessage = '';
 
    this.inserted.setData([]);
    this.updated.setData([]);
    this.unchanged.setData([]);
    this.skipped.setData([]);
  }
 
  // ==========================================
  // DISPLAY VALUE
  // ==========================================
 
  displayValue(value: any): string {
    if (value === null || value === undefined || value === '') {
      return '-';
    }
 
    return String(value);
  }
 
  // ==========================================
  // FORMAT DATE
  // Backend mengirim travel_date/end_date dalam
  // format YYYY-MM-DD. Ditampilkan sebagai DD-MM-YYYY.
  // ==========================================
 
  formatDate(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }
 
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
 
    if (!match) {
      return String(value);
    }
 
    const [, year, month, day] = match;
 
    return `${day}-${month}-${year}`;
  }
 
  // ==========================================
  // TRACK BY
  // ==========================================
 
  trackByRow(_index: number, item: any): any {
    return item.id ?? item.row;
  }
}
