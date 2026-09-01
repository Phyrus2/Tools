import { ChangeDetectionStrategy, Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Product, ProductImportResult } from '../../services/product';

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
  selector: 'app-import-product',
  imports: [CommonModule, FormsModule],
  templateUrl: './product-import.html',
  styleUrl: './product-import.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class ProductImport {
   selectedFile: File | null = null;
    loading = false;
    result: ProductImportResult | null = null;
    errorMessage = '';
   
    inserted = new Paginator<ProductImportResult['insertedRows'][number]>();
    updated = new Paginator<ProductImportResult['updatedRows'][number]>();
    skipped = new Paginator<ProductImportResult['skippedRows'][number]>();
   
    constructor(
      private service: Product,
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
   
    importProduct() {
      this.errorMessage = '';
   
      if (!this.selectedFile) {
        this.errorMessage = 'Please select an Excel file.';
        return;
      }
   
      this.loading = true;
      this.cdr.markForCheck();
   
      this.service.importProduct(this.selectedFile).subscribe({
        next: (response) => {
          this.loading = false;
   
          // Let the button repaint first, then assign the (possibly large)
          // result on the next tick so the UI doesn't look frozen while
          // Angular processes/paginates tens of thousands of rows.
          setTimeout(() => {
            this.result = response;
   
            this.inserted.setData(response.insertedRows);
            this.updated.setData(response.updatedRows);
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
      this.skipped.setData([]);
    }
   
    // ==========================================
    // TRACK BY
    // ==========================================
   
    trackByRow(_index: number, item: any): any {
      return item.product_id ?? item.row;
    }
}
