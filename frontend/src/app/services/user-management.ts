import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PermissionKey } from '../auth/auth.service';
import { API_URL } from './api-config';

export interface PermissionDefinition {
  key: PermissionKey;
  group: string;
  label: string;
}

export interface ManagedUser {
  id: number;
  fullname: string;
  username: string;
  role: 'ADMIN' | 'USER' | 'OPERATION' | 'SALES';
  status: 'ACTIVE' | 'INACTIVE';
  last_login: string | null;
  created_at: string;
  updated_at: string;
  permissions: PermissionKey[];
}

export interface CreateUserPayload {
  fullname: string;
  username: string;
  password: string;
  role: 'ADMIN' | 'USER';
  status: 'ACTIVE' | 'INACTIVE';
  permissions: PermissionKey[];
}

@Injectable({ providedIn: 'root' })
export class UserManagementService {
  constructor(private readonly http: HttpClient) {}

  listUsers(): Observable<{ success: true; users: ManagedUser[] }> {
    return this.http.get<{ success: true; users: ManagedUser[] }>(`${API_URL}/admin/users`);
  }

  listPermissions(): Observable<{ success: true; permissions: PermissionDefinition[] }> {
    return this.http.get<{ success: true; permissions: PermissionDefinition[] }>(`${API_URL}/admin/permissions`);
  }

  createUser(payload: CreateUserPayload): Observable<{ success: true; userId: number }> {
    return this.http.post<{ success: true; userId: number }>(`${API_URL}/admin/users`, payload);
  }

  updateUser(userId: number, payload: Pick<CreateUserPayload, 'fullname' | 'username' | 'role' | 'status'>): Observable<unknown> {
    return this.http.patch(`${API_URL}/admin/users/${userId}`, payload);
  }

  updatePermissions(userId: number, permissions: PermissionKey[]): Observable<unknown> {
    return this.http.put(`${API_URL}/admin/users/${userId}/permissions`, { permissions });
  }

  resetPassword(userId: number, password: string): Observable<unknown> {
    return this.http.post(`${API_URL}/admin/users/${userId}/reset-password`, { password });
  }

  logoutSessions(userId: number): Observable<unknown> {
    return this.http.post(`${API_URL}/admin/users/${userId}/logout-sessions`, {});
  }
}
