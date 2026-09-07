import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_URL } from '../services/api-config';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const isApiRequest = request.url === API_URL || request.url.startsWith(`${API_URL}/`);
  const isLogin = request.url === `${API_URL}/auth/login`;

  const authorizedRequest = isApiRequest && auth.token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${auth.token}` } })
    : request;

  return next(authorizedRequest).pipe(
    catchError((error: HttpErrorResponse) => {
      if (isApiRequest && !isLogin && error.status === 401) {
        auth.clearSession();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
