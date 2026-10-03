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

// Room the popover needs (px); used to decide which way it opens.
const POPOVER_HEIGHT = 400;
const POPOVER_WIDTH = 310;

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
  @Input() ariaLabel = 'Select date';
  @Input() displayFormat: 'long' | 'dd/mm/yyyy' = 'long';
  @Output() readonly valueChange = new EventEmitter<string>();

  open = false;
  openUpward = false;
  alignRight = false;
  viewDate = this.startOfMonth(new Date());

  readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  readonly monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value'] && this.value) {
      const selected = this.parseIso(this.value);
      if (selected) this.viewDate = this.startOfMonth(selected);
    }
  }

  get displayValue(): string {
    const selected = this.parseIso(this.value);
    if (!selected) return 'Select date';

    if (this.displayFormat === 'dd/mm/yyyy') {
      return [
        String(selected.getDate()).padStart(2, '0'),
        String(selected.getMonth() + 1).padStart(2, '0'),
        selected.getFullYear(),
      ].join('/');
    }

    return `${selected.getDate()} ${this.monthNames[selected.getMonth()]} ${selected.getFullYear()}`;
  }

  get calendarDays(): CalendarDay[] {
    const year = this.viewDate.getFullYear();
    const month = this.viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const mondayOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - mondayOffset);

    // Five rows are enough unless the month spills into a sixth week.
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = mondayOffset + daysInMonth > 35 ? 42 : 35;

    return Array.from({ length: cells }, (_, index) => {
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

  /** Years offered in the header dropdown: the min/max bounds when set, otherwise ten years either side of today. */
  get yearOptions(): number[] {
    const thisYear = new Date().getFullYear();
    const viewYear = this.viewDate.getFullYear();
    const minYear = this.parseIso(this.min)?.getFullYear() ?? Math.min(thisYear - 10, viewYear);
    const maxYear = this.parseIso(this.max)?.getFullYear() ?? Math.max(thisYear + 10, viewYear);
    const from = Math.min(minYear, viewYear);
    const to = Math.max(maxYear, viewYear);
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  }

  setMonth(month: string): void {
    this.viewDate = new Date(this.viewDate.getFullYear(), Number(month), 1);
  }

  setYear(year: string): void {
    this.viewDate = new Date(Number(year), this.viewDate.getMonth(), 1);
  }

  toggle(): void {
    this.open = !this.open;

    if (this.open) {
      const selected = this.parseIso(this.value);
      this.viewDate = this.startOfMonth(selected ?? new Date());
      this.placePopover();
    }
  }

  /** Open upward / right-aligned when the popover would not fit below or beside the field. */
  private placePopover(): void {
    const rect = this.elementRef.nativeElement.getBoundingClientRect();
    const headerBottom = Math.max(0, document.querySelector('app-header')?.getBoundingClientRect().bottom ?? 0);
    const below = window.innerHeight - rect.bottom;
    const above = rect.top - headerBottom;
    this.openUpward = below < POPOVER_HEIGHT && above > below;
    this.alignRight = rect.left + POPOVER_WIDTH > window.innerWidth - 16 && rect.right - POPOVER_WIDTH >= 0;
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
