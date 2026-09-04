import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';

interface CalendarDay {
  date: Date;
  iso: string;
  day: number;
  outsideMonth: boolean;
  disabled: boolean;
}

@Component({
  selector: 'app-date-picker',
  imports: [CommonModule],
  templateUrl: './date-picker.html',
  styleUrl: './date-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DatePicker implements OnChanges {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  @Input() value = '';
  @Input() min = '';
  @Input() max = '';
  @Input() ariaLabel = 'Pilih tanggal';
  @Output() readonly valueChange = new EventEmitter<string>();

  open = false;
  viewDate = this.startOfMonth(new Date());

  readonly weekdays = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  readonly monthNames = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value'] && this.value) {
      const selected = this.parseIso(this.value);
      if (selected) this.viewDate = this.startOfMonth(selected);
    }
  }

  get displayValue(): string {
    const selected = this.parseIso(this.value);
    if (!selected) return 'Pilih tanggal';

    return `${selected.getDate()} ${this.monthNames[selected.getMonth()]} ${selected.getFullYear()}`;
  }

  get calendarDays(): CalendarDay[] {
    const year = this.viewDate.getFullYear();
    const month = this.viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const mondayOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - mondayOffset);

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + index,
      );
      const iso = this.toIso(date);

      return {
        date,
        iso,
        day: date.getDate(),
        outsideMonth: date.getMonth() !== month,
        disabled: this.isDisabled(iso),
      };
    });
  }

  toggle(): void {
    this.open = !this.open;

    if (this.open) {
      const selected = this.parseIso(this.value);
      this.viewDate = this.startOfMonth(selected ?? new Date());
    }
  }

  previousMonth(): void {
    this.viewDate = new Date(
      this.viewDate.getFullYear(),
      this.viewDate.getMonth() - 1,
      1,
    );
  }

  nextMonth(): void {
    this.viewDate = new Date(
      this.viewDate.getFullYear(),
      this.viewDate.getMonth() + 1,
      1,
    );
  }

  selectDay(day: CalendarDay): void {
    if (day.disabled) return;

    this.valueChange.emit(day.iso);
    this.open = false;
  }

  selectToday(): void {
    const today = this.toIso(new Date());
    if (this.isDisabled(today)) return;

    this.valueChange.emit(today);
    this.viewDate = this.startOfMonth(new Date());
    this.open = false;
  }

  clear(): void {
    this.valueChange.emit('');
    this.open = false;
  }

  isSelected(iso: string): boolean {
    return Boolean(this.value && iso === this.value);
  }

  isToday(iso: string): boolean {
    return iso === this.toIso(new Date());
  }

  @HostListener('document:click', ['$event'])
  closeWhenClickingOutside(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.open = false;
    }
  }

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    this.open = false;
  }

  private isDisabled(iso: string): boolean {
    return Boolean((this.min && iso < this.min) || (this.max && iso > this.max));
  }

  private parseIso(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  private toIso(date: Date): string {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
}
