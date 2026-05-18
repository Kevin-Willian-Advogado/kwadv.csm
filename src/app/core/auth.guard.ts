import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { LoginService } from './login.service';
import { SettingsService } from './settings.service';

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

export const articlesFeatureGuard: CanActivateFn = () => {
  const loginService = inject(LoginService);
  const router = inject(Router);

  if (!loginService.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  return inject(SettingsService).getSettings().pipe(
    map((settings) => (settings.articlesEnabled ? true : router.createUrlTree(['/configuracoes']))),
    catchError(() => of(true)),
  );
};

export const articlesHomeMatchGuard: CanMatchFn = () => {
  const loginService = inject(LoginService);
  const router = inject(Router);

  if (!loginService.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  return inject(SettingsService).getSettings().pipe(
    map((settings) => settings.articlesEnabled),
    catchError(() => of(true)),
  );
};

export const guestGuard: CanActivateFn = () => {
  const loginService = inject(LoginService);
  const router = inject(Router);

  if (!loginService.isAuthenticated()) {
    return true;
  }

  return inject(SettingsService).getSettings().pipe(
    map((settings) => router.createUrlTree([settings.articlesEnabled ? '/artigos' : '/configuracoes'])),
    catchError(() => of(router.createUrlTree(['/configuracoes']))),
  );
};
