import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';

import { LoginService } from './login.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const loginService = inject(LoginService);
  const router = inject(Router);

  if (loginService.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url },
  });
};

export const authChildGuard: CanActivateChildFn = (route, state) => authGuard(route, state);

export const guestGuard: CanActivateFn = () => {
  const loginService = inject(LoginService);
  const router = inject(Router);

  if (!loginService.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/artigos']);
};
