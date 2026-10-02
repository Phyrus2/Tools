import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-contract-hub',
  imports: [CommonModule, RouterLink],
  templateUrl: './contract-hub.html',
  styleUrl: './contract-hub.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractHub {
  readonly auth = inject(AuthService);
  readonly toolCount = Number(this.auth.hasPermission('contract_monitoring'))
    + Number(this.auth.hasPermission('hotel_options'))
    + Number(this.auth.hasPermission('stop_sales'));
}
