import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-time-picker',
  imports: [CommonModule, FormsModule],
  templateUrl: './time-picker.html',
  styleUrl: './time-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimePicker {
  @Input() value = '00:00';
  @Input() ariaLabel = 'Select time';
  @Output() readonly valueChange = new EventEmitter<string>();

  readonly hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
  readonly minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

  get hour(): string {
    return this.parts()[0];
  }

  get minute(): string {
    return this.parts()[1];
  }

  setHour(hour: string): void {
    this.valueChange.emit(`${hour}:${this.minute}`);
  }

  setMinute(minute: string): void {
    this.valueChange.emit(`${this.hour}:${minute}`);
  }

  private parts(): [string, string] {
    const match = /^(\d{2}):(\d{2})$/.exec(this.value);
    return match ? [match[1], match[2]] : ['00', '00'];
  }
}
