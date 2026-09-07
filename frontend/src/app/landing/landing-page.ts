import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-landing-page',
  imports: [RouterLink],
  templateUrl: './landing-page.html',
  styleUrl: './landing-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPage {
  constructor(readonly auth: AuthService, private readonly router: Router) {}

  logout(): void {
    this.auth.logout().subscribe(() => void this.router.navigate(['/login']));
  }
}
