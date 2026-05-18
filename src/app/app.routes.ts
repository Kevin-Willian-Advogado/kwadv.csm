import { Routes } from '@angular/router';

import {
  articlesFeatureGuard,
  articlesHomeMatchGuard,
  authChildGuard,
  authGuard,
  guestGuard,
} from './core/auth.guard';

const loadLayout = () => import('./layout/layout/layout').then((m) => m.Layout);
const loadArticlesList = () => import('./features/articles/pages/articles-list/articles-list').then((m) => m.ArticlesList);
const loadArticleDetail = () => import('./features/articles/pages/article-detail/article-detail').then((m) => m.ArticleDetail);
const loadAuthorList = () => import('./features/authors/pages/author-list/author-list').then((m) => m.AuthorList);
const loadCategoryList = () => import('./features/categories/pages/category-list/category-list').then((m) => m.CategoryList);
const loadUserList = () => import('./features/users/user-list/user-list').then((m) => m.UserList);
const loadSettings = () => import('./features/settings/settings').then((m) => m.Settings);
const loadMessages = () => import('./features/messages/messages').then((m) => m.Messages);
const loadLogin = () => import('./features/login/login/login').then((m) => m.Login);
const loadResetPassword = () => import('./features/login/reset-password/reset-password').then((m) => m.ResetPassword);
const loadValidateEmail = () => import('./features/login/validate-email/validate-email').then((m) => m.ValidateEmail);

export const routes: Routes = [
  {
    path: '',
    canMatch: [articlesHomeMatchGuard],
    redirectTo: 'artigos',
    pathMatch: 'full',
  },
  {
    path: '',
    redirectTo: 'configuracoes',
    pathMatch: 'full',
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: loadLogin,
  },
  {
    path: 'redefinir-senha',
    loadComponent: loadResetPassword,
  },
  {
    path: 'validar-email',
    loadComponent: loadValidateEmail,
  },
  {
    path: 'artigos/novo',
    canActivate: [authGuard, articlesFeatureGuard],
    loadComponent: loadArticleDetail,
  },
  {
    path: 'artigos/:slug',
    canActivate: [authGuard, articlesFeatureGuard],
    loadComponent: loadArticleDetail,
  },
  {
    path: 'artigo/novo',
    redirectTo: 'artigos/novo',
    pathMatch: 'full',
  },
  {
    path: 'artigo/:slug',
    redirectTo: 'artigos/:slug',
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authChildGuard],
    loadComponent: loadLayout,
    children: [
      {
        path: 'artigos',
        canActivate: [articlesFeatureGuard],
        loadComponent: loadArticlesList,
      },
      {
        path: 'autores/novo',
        canActivate: [articlesFeatureGuard],
        loadComponent: loadAuthorList,
      },
      {
        path: 'autores/:id',
        canActivate: [articlesFeatureGuard],
        loadComponent: loadAuthorList,
      },
      {
        path: 'autores',
        canActivate: [articlesFeatureGuard],
        loadComponent: loadAuthorList,
      },
      {
        path: 'categorias/nova',
        canActivate: [articlesFeatureGuard],
        loadComponent: loadCategoryList,
      },
      {
        path: 'categorias/:id',
        canActivate: [articlesFeatureGuard],
        loadComponent: loadCategoryList,
      },
      {
        path: 'categorias',
        canActivate: [articlesFeatureGuard],
        loadComponent: loadCategoryList,
      },
      {
        path: 'mensagens',
        loadComponent: loadMessages,
      },
      {
        path: 'usuarios/novo',
        loadComponent: loadUserList,
      },
      {
        path: 'usuarios/:id',
        loadComponent: loadUserList,
      },
      {
        path: 'usuarios',
        loadComponent: loadUserList,
      },
      {
        path: 'configuracoes',
        loadComponent: loadSettings,
      },
    ],
  },
  {
    path: '**',
    canMatch: [articlesHomeMatchGuard],
    redirectTo: 'artigos',
  },
  {
    path: '**',
    redirectTo: 'configuracoes',
  },
];
