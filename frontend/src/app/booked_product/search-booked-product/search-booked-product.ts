import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';

import {
  Search,
  BookedProductSearchParams,
  BookedProductSearchResult,
} from '../../services/search';

type DateMode = 'none' | 'single' | 'range';

const PAGE_SIZE = 25;
const MIN_KEYWORD_LENGTH = 2;

@Component({
  selector: 'app-search-booked-product',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './search-booked-product.html',
  styleUrl: './search-booked-product.scss',
})
export class SearchBookedProduct implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private bookedProductService = inject(Search);
  private cdr = inject(ChangeDetectorRef);

  form = this.fb.group({
    keyword: [''],
    dateMode: ['none' as DateMode],
    date: [''],
    startDate: [''],
    endDate: [''],
  });

  results: BookedProductSearchResult[] = [];
  page = 1;
  totalPages = 1;
  total = 0;

  loading = false;
  errorMessage: string | null = null;
  hasSearched = false;

  selectedItem: BookedProductSearchResult | null = null;

  private readonly search$ = new Subject<void>();
  private subscription?: Subscription;

  ngOnInit(): void {
    // Trigger pencarian otomatis saat user berhenti mengetik.
    this.subscription = this.form
      .get('keyword')!
      .valueChanges.pipe(debounceTime(400), distinctUntilChanged())
      .subscribe((keyword) => {
        console.log('🔍 Keyword:', keyword);

        this.page = 1;
        this.triggerSearch();
      });

    this.subscription.add(
      this.search$
        .pipe(
          tap(() => {
            console.log('🚀 Search triggered');

            this.loading = true;
            this.errorMessage = null;
            this.cdr.markForCheck();
          }),

          switchMap(() => {
            const params = this.buildParams();

            console.log('📤 Search Params:', params);

            if (!params) {
              console.log('⚠️ Params kosong / invalid');

              this.loading = false;
              this.cdr.markForCheck();
              return [];
            }

            return this.bookedProductService.searchBookedProduct(params);
          }),
        )
        .subscribe({
          next: (response) => {
            console.log('📥 API Response:', response);

            if (!response) {
              console.log('⚠️ Response kosong');
              this.loading = false;
              this.cdr.markForCheck();
              return;
            }

            console.log('📦 Results:', response.results);
            console.log('📄 Pagination:', response.pagination);

            this.loading = false;
            this.hasSearched = true;
            this.results = response.results;
            this.page = response.pagination.page;
            this.totalPages = response.pagination.totalPages;
            this.total = response.pagination.total;
            this.cdr.markForCheck();
          },

          error: (err) => {
            console.error('❌ API Error:', err);

            console.error('❌ Error Message:', err?.error?.message);

            this.loading = false;
            this.hasSearched = true;
            this.results = [];

            this.errorMessage = err?.error?.message || 'Gagal melakukan pencarian.';
            this.cdr.markForCheck();
          },
        }),
    );
  }

  openDetail(item: BookedProductSearchResult): void {
    this.selectedItem = item;
  }

  closeDetail(): void {
    this.selectedItem = null;
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  formatLongText(text: string | null): string {
    if (!text) return '';

    // 1) ratakan semua whitespace (spasi ganda, newline, dsb) jadi satu spasi
    let formatted = text.replace(/\s+/g, ' ').trim();

    // 2) baris baru sebelum "DAY <angka>" (dengan/tanpa titik dua),
    //    kecuali kalau nempel langsung setelah kata "Itinerary"
    formatted = formatted.replace(/(?<!Itinerary\s)\s*(?=DAY\s*\d+\b)/gi, '\n\n');

    // 3) baris baru sebelum "Meals:"
    formatted = formatted.replace(/\s*(?=Meals\s*:)/gi, '\n');

    // 4) baris baru sebelum setiap item dash " - "
    formatted = formatted.replace(/\s+-\s+/g, '\n- ');

    // 5) rapikan spasi nyasar & batasi baris kosong berlebih
    formatted = formatted
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');

    return formatted.trim();
  }

  // =====================================================
  // ACTIONS
  // =====================================================

  onSubmit(): void {
    this.page = 1;
    this.triggerSearch();
  }

  onDateModeChange(): void {
    this.form.patchValue({ date: '', startDate: '', endDate: '' });
    this.page = 1;
    this.triggerSearch();
  }

  onDateFieldChange(): void {
    this.page = 1;
    this.triggerSearch();
  }

  goToPage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.totalPages || nextPage === this.page) {
      return;
    }
    this.page = nextPage;
    this.triggerSearch();
  }

  clearSearch(): void {
    this.form.reset({
      keyword: '',
      dateMode: 'none',
      date: '',
      startDate: '',
      endDate: '',
    });
    this.results = [];
    this.hasSearched = false;
    this.errorMessage = null;
    this.page = 1;
    this.totalPages = 1;
    this.total = 0;
  }

  matchedFieldLabel(field: string): string {
    const labels: Record<string, string> = {
      company_name: 'Nama Supplier',
      town: 'Kota',
      region: 'Wilayah',
      location: 'Lokasi',
      product_name: 'Nama Produk',
      description: 'Deskripsi',
      info: 'Info',
      instructions: 'Instruksi',
      other: 'Lainnya',
    };
    return labels[field] ?? field;
  }

  // =====================================================
  // INTERNAL
  // =====================================================

  private triggerSearch(): void {
    const keyword = (this.form.value.keyword ?? '').trim();

    if (keyword.length < MIN_KEYWORD_LENGTH) {
      this.results = [];
      this.hasSearched = false;
      this.errorMessage = null;
      this.total = 0;
      this.totalPages = 1;
      this.cdr.markForCheck();
      return;
    }

    this.search$.next();
  }

  private buildParams(): BookedProductSearchParams | null {
    const value = this.form.value;
    const keyword = (value.keyword ?? '').trim();

    if (keyword.length < MIN_KEYWORD_LENGTH) {
      return null;
    }

    const params: BookedProductSearchParams = {
      keyword,
      page: this.page,
      limit: PAGE_SIZE,
    };

    if (value.dateMode === 'single' && value.date) {
      params.date = value.date;
    } else if (value.dateMode === 'range') {
      if (value.startDate) params.startDate = value.startDate;
      if (value.endDate) params.endDate = value.endDate;
    }

    return params;
  }
}
