import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { televisionExistsGuard } from './features/televisions/television-exists.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((module) => module.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layout/admin-layout').then((module) => module.AdminLayout),
    children: [
      {
        path: 'televisions/connect',
        loadComponent: () =>
          import('./features/televisions/connect/connect-television').then(
            (module) => module.ConnectTelevision,
          ),
      },
      {
        path: 'televisions/:id',
        canActivate: [televisionExistsGuard],
        loadComponent: () =>
          import('./features/televisions/detail/television-detail').then(
            (module) => module.TelevisionDetail,
          ),
      },
      {
        path: 'televisions',
        loadComponent: () =>
          import('./features/televisions/list/televisions').then((module) => module.Televisions),
      },
      { path: '', pathMatch: 'full', redirectTo: 'televisions' },
      {
        path: '404',
        loadComponent: () =>
          import('./features/not-found/not-found').then((module) => module.NotFound),
      },
      { path: '**', redirectTo: '/404' },
    ],
  },
];
