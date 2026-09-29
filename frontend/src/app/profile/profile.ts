import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-profile',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile {
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);
  readonly savingProfile = signal(false);
  readonly savingPassword = signal(false);
  readonly profileMessage = signal('');
  readonly passwordMessage = signal('');
  readonly profileError = signal('');
  readonly passwordError = signal('');

  readonly profileForm = this.fb.nonNullable.group({
    fullname: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(150)]],
    username: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9._-]{3,100}$/)]],
    currentPassword: ['', [Validators.required, Validators.maxLength(128)]],
  });

  readonly passwordForm = this.fb.nonNullable.group({
    currentPassword: ['', [Validators.required, Validators.maxLength(128)]],
    newPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
    confirmation: ['', [Validators.required, Validators.maxLength(128)]],
  });

  constructor() {
    const user = this.auth.user();
    if (user) {
      this.profileForm.reset({ fullname: user.fullname, username: user.username, currentPassword: '' });
    }
  }

  saveProfile(): void {
    if (this.profileForm.invalid || this.savingProfile()) {
      this.profileForm.markAllAsTouched();
      return;
    }
    this.savingProfile.set(true);
    this.profileMessage.set('');
    this.profileError.set('');
    const value = this.profileForm.getRawValue();
    this.auth.updateProfile(value.fullname, value.username, value.currentPassword).subscribe({
      next: (user) => {
        this.profileForm.reset({ fullname: user.fullname, username: user.username, currentPassword: '' });
        this.profileMessage.set('Profil berhasil diperbarui. Sesi lain telah dikeluarkan.');
        this.savingProfile.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.profileError.set(this.apiError(error));
        this.savingProfile.set(false);
      },
    });
  }

  changePassword(): void {
    if (this.passwordForm.invalid || this.savingPassword()) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    const value = this.passwordForm.getRawValue();
    if (value.newPassword !== value.confirmation) {
      this.passwordError.set('Konfirmasi password baru tidak sama.');
      return;
    }
    this.savingPassword.set(true);
    this.passwordMessage.set('');
    this.passwordError.set('');
    this.auth.changePassword(value.currentPassword, value.newPassword).subscribe({
      next: () => {
        this.passwordForm.reset({ currentPassword: '', newPassword: '', confirmation: '' });
        this.passwordMessage.set('Password berhasil diganti. Sesi lain telah dikeluarkan.');
        this.savingPassword.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.passwordError.set(this.apiError(error));
        this.savingPassword.set(false);
      },
    });
  }

  private apiError(error: HttpErrorResponse): string {
    return typeof error.error?.message === 'string' ? error.error.message : 'Permintaan gagal. Coba kembali.';
  }
}
