import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-contract-hub',
  imports: [CommonModule, RouterLink],
  templateUrl: './contract-hub.html',
  styleUrl: './contract-hub.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractHub {}
