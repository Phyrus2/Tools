import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnInit,
} from '@angular/core';
import {
  Supplier,
  ImportResult,
  SupplierImportHistory,
} from '../../services/supplier';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

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

type SectionKey = 'new' | 'updated' | 'unchanged' | 'skipped' | null;

@Component({
  selector: 'app-supplier-import',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './supplier-import.html',
  styleUrl: './supplier-import.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupplierImport implements OnInit {
  selectedFile: File | null = null;
    category = '';
    loading = false;
    result: ImportResult | null = null;
    errorMessage = '';
    confirmationOpen = false;
    latestImport: SupplierImportHistory | null = null;
    undoing = false;
    undoMessage = '';

    // Which summary card's detail is currently open in the modal.
    activeSection: SectionKey = null;
  
    // One paginator per table/section
    inserted = new Paginator<ImportResult['insertedRows'][number]>();
    updated = new Paginator<ImportResult['updatedRows'][number]>();
    unchanged = new Paginator<ImportResult['unchangedRows'][number]>();
    skipped = new Paginator<ImportResult['skippedRows'][number]>();
  
    constructor(
      private service: Supplier,
      private cdr: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {
      this.loadLatestImport();
    }
  
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
      this.confirmationOpen = false;
      this.undoMessage = '';
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

      this.confirmationOpen = true;
      this.cdr.markForCheck();
    }

    cancelImport(): void {
      this.confirmationOpen = false;
      this.cdr.markForCheck();
    }

    confirmImport(): void {
      if (!this.selectedFile || !this.category) {
        this.confirmationOpen = false;
        return;
      }

      const file = this.selectedFile;
      const category = this.category;

      this.confirmationOpen = false;
      this.undoMessage = '';
  
      this.loading = true;
      // Under OnPush, mutating a plain property still needs a manual
      // markForCheck() so the "Processing..." button label repaints
      // immediately, before the potentially heavy response handling below.
      this.cdr.markForCheck();
  
      this.service.importSupplier(file, category).subscribe({
        next: (response) => {
          this.loading = false;
          this.cdr.markForCheck();

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

            // A fresh import replaces whatever was open before.
            this.activeSection = null;
            this.loadLatestImport();
  
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

    get suggestedCategory(): string | null {
      if (!this.selectedFile) {
        return null;
      }

      const normalizedFileName = this.selectedFile.name
        .replace(/\.[^.]+$/, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      const categories = [
        'ACCOMMODATION',
        'ACTIVITIES',
        'BOAT',
        'FLIGHT',
        'LIVEABOARD',
        'LOCAL AGENT',
        'RESTAURANT',
        'VISA',
      ];

      return (
        categories.find((item) =>
          normalizedFileName.includes(item.replace(/[^A-Z0-9]/g, '')),
        ) ?? null
      );
    }

    get categoryMismatch(): boolean {
      return Boolean(
        this.suggestedCategory && this.suggestedCategory !== this.category,
      );
    }

    undoLatestImport(): void {
      if (!this.latestImport?.canUndo || this.undoing) {
        return;
      }

      const approved = window.confirm(
        `Batalkan penambahan kategori ${this.latestImport.category} dari import ${this.latestImport.fileName}? Supplier tidak akan dihapus.`,
      );

      if (!approved) {
        return;
      }

      this.undoing = true;
      this.undoMessage = '';
      this.cdr.markForCheck();

      this.service.undoImport(this.latestImport.importId).subscribe({
        next: (response) => {
          this.undoing = false;
          this.undoMessage = response.message;
          this.loadLatestImport();
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.undoing = false;
          this.errorMessage =
            error.error?.message || 'Gagal membatalkan import supplier.';
          this.cdr.markForCheck();
        },
      });
    }

    private loadLatestImport(): void {
      this.service.getLatestImport().subscribe({
        next: (response) => {
          this.latestImport = response.latest;
          this.cdr.markForCheck();
        },
        error: () => {
          this.latestImport = null;
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
      this.activeSection = null;
      this.confirmationOpen = false;
      this.undoMessage = '';
  
      this.inserted.setData([]);
      this.updated.setData([]);
      this.unchanged.setData([]);
      this.skipped.setData([]);
    }
  
    // ==========================================
    // DETAIL MODAL
    // ==========================================
  
    openSection(key: SectionKey): void {
      this.activeSection = key;
      this.cdr.markForCheck();
    }
  
    closeSection(): void {
      this.activeSection = null;
      this.cdr.markForCheck();
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
