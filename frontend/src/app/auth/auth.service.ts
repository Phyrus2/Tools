import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, finalize, map, of, tap } from 'rxjs';
import { API_URL } from '../services/api-config';

export interface AdminUser {
  id: number;
  fullname: string;
  username: string;
  role: 'ADMIN';
}

interface LoginResponse {
  success: true;
  token: string;
  expiresInSeconds: number;
  user: AdminUser;
}

const TOKEN_KEY = 'database-tools-admin-session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<AdminUser | null>(null);
  private tokenValue = sessionStorage.getItem(TOKEN_KEY);

  constructor(private readonly http: HttpClient) {}

  get token(): string | null {
    return this.tokenValue;
  }

  login(username: string, password: string): Observable<AdminUser> {
    return this.http.post<LoginResponse>(`${API_URL}/auth/login`, { username, password }).pipe(
      tap((response) => {
        this.tokenValue = response.token;
        sessionStorage.setItem(TOKEN_KEY, response.token);
        this.user.set(response.user);
      }),
      map((response) => response.user),
    );
  }

  validateSession(): Observable<boolean> {
    if (!this.tokenValue) return of(false);
    return this.http.get<{ success: true; user: AdminUser }>(`${API_URL}/auth/me`).pipe(
      tap((response) => this.user.set(response.user)),
      map(() => true),
      catchError(() => {
        this.clearSession();
        return of(false);
      }),
    );
  }

  logout(): Observable<unknown> {
    return (this.tokenValue
      ? this.http.post(`${API_URL}/auth/logout`, {}).pipe(catchError(() => of(null)))
      : of(null)).pipe(finalize(() => this.clearSession()));
  }

  clearSession(): void {
    this.tokenValue = null;
    this.user.set(null);
    sessionStorage.removeItem(TOKEN_KEY);
  }
}
