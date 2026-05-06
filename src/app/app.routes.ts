import { Routes } from '@angular/router';

import { authChildGuard, authGuard, guestGuard } from './core/auth.guard';

const loadLayout = () => import('./layout/layout/layout').then((m) => m.Layout);
const loadArticlesList = () => import('./features/articles/pages/articles-list/articles-list').then((m) => m.ArticlesList);
const loadArticleDetail = () => import('./features/articles/pages/article-detail/article-detail').then((m) => m.ArticleDetail);
const loadAuthorList = () => import('./features/authors/pages/author-list/author-list').then((m) => m.AuthorList);
const loadCategoryList = () => import('./features/categories/pages/category-list/category-list').then((m) => m.CategoryList);
const loadUserList = () => import('./features/users/user-list/user-list').then((m) => m.UserList);
const loadFeaturePlaceholder = () =>
  import('./shared/feature-placeholder/feature-placeholder').then((m) => m.FeaturePlaceholder);
const loadLogin = () => import('./features/login/login/login').then((m) => m.Login);

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'artigos',
    pathMatch: 'full',
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: loadLogin,
  },
  {
    path: 'artigos/novo',
    canActivate: [authGuard],
    loadComponent: loadArticleDetail,
  },
  {
    path: 'artigos/:slug',
    canActivate: [authGuard],
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
        loadComponent: loadArticlesList,
      },
      {
        path: 'autores/novo',
        loadComponent: loadAuthorList,
      },
      {
        path: 'autores/:id',
        loadComponent: loadAuthorList,
      },
      {
        path: 'autores',
        loadComponent: loadAuthorList,
      },
      {
        path: 'categorias/nova',
        loadComponent: loadCategoryList,
      },
      {
        path: 'categorias/:id',
        loadComponent: loadCategoryList,
      },
      {
        path: 'categorias',
        loadComponent: loadCategoryList,
      },
      {
        path: 'mensagens',
        loadComponent: loadFeaturePlaceholder,
        data: {
          title: 'Mensagens',
          description: 'A area de mensagens ainda nao esta conectada aos dados reais do CMS.',
        },
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
    ],
  },
];
