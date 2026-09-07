import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly form = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.required, Validators.maxLength(128)]],
  });
  loading = false;
  errorMessage = '';
  showPassword = false;

  submit(): void {
    if (this.form.invalid || this.loading) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    const { username, password } = this.form.getRawValue();
    this.auth.login(username.trim(), password).pipe(
      finalize(() => {
        this.loading = false;
        this.cdr.markForCheck();
      }),
    ).subscribe({
      next: () => {
        const requested = this.route.snapshot.queryParamMap.get('returnUrl');
        const returnUrl = requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/';
        void this.router.navigateByUrl(returnUrl);
      },
      error: (error) => {
        this.errorMessage = error.status === 429
          ? 'Terlalu banyak percobaan. Tunggu 15 menit lalu coba lagi.'
          : 'Username atau password salah.';
      },
    });
  }
}
