import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { API_URL } from '../services/api-config';

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('stores a valid admin session after login', () => {
    auth.login('admin', 'a-secure-password').subscribe();
    const request = http.expectOne(`${API_URL}/auth/login`);
    expect(request.request.method).toBe('POST');
    request.flush({
      success: true,
      token: 'test-token',
      expiresInSeconds: 28800,
      user: { id: 1, fullname: 'Administrator', username: 'admin', role: 'ADMIN', permissions: ['user_management'] },
    });
    expect(auth.token).toBe('test-token');
    expect(localStorage.getItem('database-tools-admin-session')).toBe('test-token');
    expect(auth.user()?.role).toBe('ADMIN');
    expect(auth.hasPermission('user_management')).toBe(true);
  });

  it('rejects validation when no session exists', () => {
    let result = true;
    auth.validateSession().subscribe((valid) => result = valid);
    expect(result).toBe(false);
    http.expectNone(`${API_URL}/auth/me`);
  });

  it('updates the in-memory user after a profile change', () => {
    auth.updateProfile('New Name', 'new.username', 'current-password').subscribe();
    const request = http.expectOne(`${API_URL}/profile`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      fullname: 'New Name',
      username: 'new.username',
      currentPassword: 'current-password',
    });
    request.flush({
      success: true,
      user: { id: 2, fullname: 'New Name', username: 'new.username', role: 'USER', permissions: ['catalog_search'] },
    });
    expect(auth.user()?.username).toBe('new.username');
  });

  it('sends both current and new passwords when changing password', () => {
    auth.changePassword('old-secret', 'new-secure-secret').subscribe();
    const request = http.expectOne(`${API_URL}/profile/change-password`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ currentPassword: 'old-secret', newPassword: 'new-secure-secret' });
    request.flush({ success: true });
  });
});
