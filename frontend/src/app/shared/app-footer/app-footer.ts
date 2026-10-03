import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-footer',
  imports: [RouterLink],
  templateUrl: './app-footer.html',
  styleUrl: './app-footer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppFooter {
  readonly year = new Date().getFullYear();

  constructor(readonly auth: AuthService) {}
}
