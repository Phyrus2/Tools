import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { API_URL } from '../services/api-config';

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
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
      user: { id: 1, fullname: 'Administrator', username: 'admin', role: 'ADMIN' },
    });
    expect(auth.token).toBe('test-token');
    expect(auth.user()?.role).toBe('ADMIN');
  });

  it('rejects validation when no session exists', () => {
    let result = true;
    auth.validateSession().subscribe((valid) => result = valid);
    expect(result).toBe(false);
    http.expectNone(`${API_URL}/auth/me`);
  });
});
