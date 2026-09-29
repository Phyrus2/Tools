import { ChangeDetectionStrategy, Component, HostListener, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-header',
  imports: [RouterLink],
  templateUrl: './app-header.html',
  styleUrl: './app-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppHeader {
  readonly menuOpen = signal(false);

  constructor(readonly auth: AuthService, private readonly router: Router) {}

  get initials(): string {
    const name = this.auth.user()?.fullname?.trim() || 'User';
    return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  logout(): void {
    this.closeMenu();
    this.auth.logout().subscribe(() => void this.router.navigate(['/login']));
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.closeMenu();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMenu();
  }
}
