import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService, PermissionKey } from '../auth/auth.service';

@Component({
  selector: 'app-landing-page',
  imports: [RouterLink],
  templateUrl: './landing-page.html',
  styleUrl: './landing-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPage {
  readonly importToolCount = computed(() => this.countPermissions(['supplier_import', 'product_import', 'booked_product_import']));
  readonly searchToolCount = computed(() => this.countPermissions(['catalog_search', 'booking_search']));
  readonly contractToolCount = computed(() => this.countPermissions(['contract_monitoring', 'hotel_options']));
  readonly canOpenImport = computed(() => this.importToolCount() > 0);
  readonly canOpenSearch = computed(() => this.searchToolCount() > 0);
  readonly canOpenContract = computed(() => this.contractToolCount() > 0);
  readonly canOpenAnalytics = computed(() => this.auth.hasPermission('analytics'));
  readonly canManageUsers = computed(() => this.auth.hasPermission('user_management'));
  readonly availableModuleCount = computed(() => [
    this.canOpenImport(), this.canOpenSearch(), this.canOpenContract(), this.canOpenAnalytics(), this.canManageUsers(),
  ].filter(Boolean).length);

  constructor(readonly auth: AuthService) {}

  toolLabel(count: number): string {
    return `${count} ${count === 1 ? 'tool' : 'tools'}`;
  }

  private countPermissions(permissions: PermissionKey[]): number {
    return permissions.filter((permission) => this.auth.hasPermission(permission)).length;
  }
}
