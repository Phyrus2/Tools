import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { AuthService, PermissionKey } from '../auth/auth.service';
import {
  CreateUserPayload,
  ManagedUser,
  PermissionDefinition,
  UserManagementService,
} from '../services/user-management';

@Component({
  selector: 'app-user-management',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-management.html',
  styleUrl: './user-management.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserManagement {
  private readonly api = inject(UserManagementService);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly users = signal<ManagedUser[]>([]);
  readonly permissionCatalog = signal<PermissionDefinition[]>([]);
  readonly selectedId = signal<number | null>(null);
  readonly searchTerm = signal('');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly createOpen = signal(false);
  readonly message = signal('');
  readonly errorMessage = signal('');
  readonly createPermissions = signal<Set<PermissionKey>>(new Set());
  readonly editPermissions = signal<Set<PermissionKey>>(new Set());

  readonly selectedUser = computed(() => this.users().find((user) => user.id === this.selectedId()) || null);
  readonly canManageAdmins = computed(() => this.auth.user()?.role === 'ADMIN');
  readonly filteredUsers = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.users();
    return this.users().filter((user) =>
      `${user.fullname} ${user.username} ${user.role} ${user.status}`.toLowerCase().includes(term));
  });
  readonly permissionGroups = computed(() => {
    const groups = new Map<string, PermissionDefinition[]>();
    for (const permission of this.permissionCatalog()) {
      const current = groups.get(permission.group) || [];
      current.push(permission);
      groups.set(permission.group, current);
    }
    return [...groups.entries()].map(([name, permissions]) => ({ name, permissions }));
  });

  readonly createForm = this.fb.nonNullable.group({
    fullname: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(150)]],
    username: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9._-]{3,100}$/)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
    role: ['USER' as 'ADMIN' | 'USER', Validators.required],
    status: ['ACTIVE' as 'ACTIVE' | 'INACTIVE', Validators.required],
  });

  readonly editForm = this.fb.nonNullable.group({
    fullname: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(150)]],
    username: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9._-]{3,100}$/)]],
    role: ['USER' as 'ADMIN' | 'USER', Validators.required],
    status: ['ACTIVE' as 'ACTIVE' | 'INACTIVE', Validators.required],
  });

  readonly passwordForm = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
  });

  constructor() {
    this.reload();
  }

  reload(selectId?: number): void {
    this.loading.set(true);
    this.errorMessage.set('');
    forkJoin({ users: this.api.listUsers(), permissions: this.api.listPermissions() }).subscribe({
      next: ({ users, permissions }) => {
        this.users.set(users.users);
        this.permissionCatalog.set(permissions.permissions);
        const targetId = selectId ?? this.selectedId();
        if (targetId && users.users.some((user) => user.id === targetId)) this.selectUser(targetId);
        else if (this.selectedId()) this.selectedId.set(null);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(this.apiError(error));
        this.loading.set(false);
      },
    });
  }

  selectUser(userId: number): void {
    const user = this.users().find((item) => item.id === userId);
    if (!user) return;
    this.selectedId.set(userId);
    this.editForm.reset({
      fullname: user.fullname,
      username: user.username,
      role: user.role === 'ADMIN' ? 'ADMIN' : 'USER',
      status: user.status,
    });
    this.editPermissions.set(new Set(user.permissions));
    this.passwordForm.reset({ password: '' });
    this.clearNotices();
  }

  canEdit(user: ManagedUser): boolean {
    if (this.isSelf(user)) return false;
    return this.canManageAdmins() || (user.role !== 'ADMIN' && !user.permissions.includes('user_management'));
  }

  isSelf(user: ManagedUser): boolean {
    return user.id === this.auth.user()?.id;
  }

  setSearch(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  toggleCreate(): void {
    this.createOpen.update((open) => !open);
    this.createForm.reset({ fullname: '', username: '', password: '', role: 'USER', status: 'ACTIVE' });
    this.createPermissions.set(new Set());
    this.clearNotices();
  }

  togglePermission(target: 'create' | 'edit', permission: PermissionKey, checked: boolean): void {
    const source = target === 'create' ? this.createPermissions : this.editPermissions;
    const updated = new Set(source());
    if (checked) updated.add(permission);
    else updated.delete(permission);
    source.set(updated);
  }

  permissionChecked(target: 'create' | 'edit', permission: PermissionKey): boolean {
    return (target === 'create' ? this.createPermissions() : this.editPermissions()).has(permission);
  }

  createUser(): void {
    if (this.createForm.invalid || this.saving()) {
      this.createForm.markAllAsTouched();
      return;
    }
    const value = this.createForm.getRawValue();
    const payload: CreateUserPayload = {
      ...value,
      permissions: value.role === 'ADMIN' ? [] : [...this.createPermissions()],
    };
    this.saving.set(true);
    this.clearNotices();
    this.api.createUser(payload).subscribe({
      next: (response) => {
        this.message.set('User berhasil dibuat.');
        this.createOpen.set(false);
        this.saving.set(false);
        this.reload(response.userId);
      },
      error: (error: HttpErrorResponse) => this.handleSaveError(error),
    });
  }

  saveProfile(): void {
    const user = this.selectedUser();
    if (!user || !this.canEdit(user) || this.editForm.invalid || this.saving()) {
      this.editForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.clearNotices();
    this.api.updateUser(user.id, this.editForm.getRawValue()).subscribe({
      next: () => {
        this.message.set('Profil user berhasil diperbarui. Sesi user telah direset.');
        this.saving.set(false);
        this.reload(user.id);
      },
      error: (error: HttpErrorResponse) => this.handleSaveError(error),
    });
  }

  savePermissions(): void {
    const user = this.selectedUser();
    if (!user || user.role === 'ADMIN' || !this.canEdit(user) || this.saving()) return;
    this.saving.set(true);
    this.clearNotices();
    this.api.updatePermissions(user.id, [...this.editPermissions()]).subscribe({
      next: () => {
        this.message.set('Akses halaman berhasil diperbarui. User harus login kembali.');
        this.saving.set(false);
        this.reload(user.id);
      },
      error: (error: HttpErrorResponse) => this.handleSaveError(error),
    });
  }

  resetPassword(): void {
    const user = this.selectedUser();
    if (!user || !this.canEdit(user) || this.passwordForm.invalid || this.saving()) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    if (!confirm(`Reset password untuk ${user.fullname}? Semua sesinya akan dikeluarkan.`)) return;
    this.saving.set(true);
    this.clearNotices();
    this.api.resetPassword(user.id, this.passwordForm.getRawValue().password).subscribe({
      next: () => {
        this.message.set('Password berhasil direset dan seluruh sesi user telah dihapus.');
        this.passwordForm.reset({ password: '' });
        this.saving.set(false);
      },
      error: (error: HttpErrorResponse) => this.handleSaveError(error),
    });
  }

  revokeSessions(): void {
    const user = this.selectedUser();
    if (!user || this.isSelf(user) || !this.canEdit(user) || this.saving()) return;
    if (!confirm(`Keluarkan semua sesi milik ${user.fullname}?`)) return;
    this.saving.set(true);
    this.clearNotices();
    this.api.logoutSessions(user.id).subscribe({
      next: () => {
        this.message.set('Semua sesi user berhasil dikeluarkan.');
        this.saving.set(false);
      },
      error: (error: HttpErrorResponse) => this.handleSaveError(error),
    });
  }

  private handleSaveError(error: HttpErrorResponse): void {
    this.errorMessage.set(this.apiError(error));
    this.saving.set(false);
  }

  private clearNotices(): void {
    this.message.set('');
    this.errorMessage.set('');
  }

  private apiError(error: HttpErrorResponse): string {
    return typeof error.error?.message === 'string' ? error.error.message : 'Permintaan gagal. Coba kembali.';
  }
}
