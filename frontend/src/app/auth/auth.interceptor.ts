import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, tap, throwError } from 'rxjs';
import Swal from 'sweetalert2';
import { API_URL } from '../services/api-config';
import { AuthService } from './auth.service';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let lastErrorKey = '';
let lastErrorAt = 0;

function responseMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

function successFallback(method: string, url: string): string {
  if (url.endsWith('/auth/login')) return 'Logged in successfully.';
  if (url.endsWith('/auth/logout')) return 'Logged out successfully.';
  if (method === 'DELETE') return 'Data deleted successfully.';
  return 'Request processed successfully.';
}

function showSuccess(message: string): void {
  void Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'success',
    title: 'Success',
    text: message,
    showConfirmButton: false,
    timer: 2200,
    timerProgressBar: true,
  });
}

function showError(error: HttpErrorResponse): void {
  const message = responseMessage(
    error.error,
    error.status === 0 ? 'Cannot reach the server. Check your connection and try again.' : 'Request failed. Please try again.',
  );
  const key = `${error.status}:${message}`;
  const now = Date.now();
  if (key === lastErrorKey && now - lastErrorAt < 2500) return;
  lastErrorKey = key;
  lastErrorAt = now;
  void Swal.fire({
    icon: 'error',
    title: 'Request failed',
    text: message,
    confirmButtonText: 'Close',
    confirmButtonColor: '#35564d',
  });
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const isApiRequest = request.url === API_URL || request.url.startsWith(`${API_URL}/`);
  const isLogin = request.url === `${API_URL}/auth/login`;

  const authorizedRequest = isApiRequest && auth.token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${auth.token}` } })
    : request;

  return next(authorizedRequest).pipe(
    tap((event) => {
      if (isApiRequest && event instanceof HttpResponse && MUTATION_METHODS.has(request.method)) {
        showSuccess(responseMessage(event.body, successFallback(request.method, request.url)));
      }
    }),
    catchError((error: HttpErrorResponse) => {
      const isSilentSessionCheck = request.method === 'GET' && request.url === `${API_URL}/auth/me`;
      if (isApiRequest && !isSilentSessionCheck) showError(error);
      if (isApiRequest && !isLogin && error.status === 401) {
        auth.clearSession();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
