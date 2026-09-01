import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { Supplier, ImportResult } from '../../services/supplier';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// ==========================================
// Generic paginator helper
// Keeps only the current page's slice in memory for rendering,
// so *ngFor never has to render more than `pageSize` rows at once.
// ==========================================
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
  selector: 'app-import',
  imports: [CommonModule, FormsModule],
  templateUrl: './import.html',
  styleUrl: './import.scss',
  // OnPush: Angular skips re-checking this component unless an @Input changes
  // or we explicitly call markForCheck(). Combined with pagination this keeps
  // change detection cheap even with tens of thousands of rows in `result`.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportComponent {
  selectedFile: File | null = null;
  category = '';
  loading = false;
  result: ImportResult | null = null;
  errorMessage = '';

  // One paginator per table/section
  inserted = new Paginator<ImportResult['insertedRows'][number]>();
  updated = new Paginator<ImportResult['updatedRows'][number]>();
  unchanged = new Paginator<ImportResult['unchangedRows'][number]>();
  skipped = new Paginator<ImportResult['skippedRows'][number]>();

  constructor(
    private service: Supplier,
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

  importSupplier() {
    this.errorMessage = '';

    if (!this.selectedFile) {
      this.errorMessage = 'Please select an Excel file.';
      return;
    }

    if (!this.category) {
      this.errorMessage = 'Please select supplier type.';
      return;
    }

    this.loading = true;
    // Under OnPush, mutating a plain property still needs a manual
    // markForCheck() so the "Processing..." button label repaints
    // immediately, before the potentially heavy response handling below.
    this.cdr.markForCheck();

    this.service.importSupplier(this.selectedFile, this.category).subscribe({
      next: (response) => {
        this.loading = false;

        // Let the "Processing..." -> "Import Supplier" repaint happen
        // FIRST, then assign the (possibly huge) result on the next tick.
        // This avoids the button appearing frozen while Angular chews
        // through slicing/paginating tens of thousands of rows.
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
    this.category = '';
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

    if (Array.isArray(value)) {
      return value.join(', ');
    }

    return String(value);
  }

  // ==========================================
  // TRACK BY (avoids re-creating DOM nodes for rows that haven't changed)
  // ==========================================

  trackByRow(_index: number, item: any): any {
    return item.supplier_id ?? item.row;
  }

  trackByCategory(_index: number, item: string): string {
    return item;
  }

  trackByField(_index: number, item: any): string {
    return item.field;
  }
}