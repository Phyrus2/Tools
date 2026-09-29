import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService, PermissionKey } from './auth.service';

export const adminGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.validateSession().pipe(
    map((valid) => {
      if (!valid) {
        return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
      }
      const permission = route.data['permission'];
      const anyPermissions = route.data['anyPermissions'];
      const allowed = typeof permission === 'string'
        ? auth.hasPermission(permission as PermissionKey)
        : Array.isArray(anyPermissions)
          ? auth.hasAnyPermission(anyPermissions as PermissionKey[])
          : true;
      return allowed ? true : router.createUrlTree(['/forbidden']);
    }),
  );
};
