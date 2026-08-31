import { Component } from '@angular/core';
import { Supplier, ImportResult } from '../../services/supplier';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; //

@Component({
  selector: 'app-import',
  imports: [
    CommonModule,
    FormsModule // 2. Daftarkan di dalam array imports komponen ini
  ],
  templateUrl: './import.html',
  styleUrl: './import.scss',
})
export class ImportComponent {
  selectedFile: File | null = null;

  category = '';

  loading = false;

  result: ImportResult | null = null;

  errorMessage = '';
  constructor(private service: Supplier) {}
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

    // File validation
    if (!this.selectedFile) {
      this.errorMessage = 'Please select an Excel file.';

      return;
    }

    // Category validation
    if (!this.category) {
      this.errorMessage = 'Please select supplier type.';

      return;
    }

    this.loading = true;

    this.service.importSupplier(this.selectedFile, this.category).subscribe({
      next: (response) => {
        this.loading = false;

        this.result = response;
      },

      error: (error) => {
        this.loading = false;

        this.errorMessage = error.error?.message || 'Import failed.';
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
}
