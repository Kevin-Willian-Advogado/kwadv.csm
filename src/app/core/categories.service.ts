import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, map, Observable, of, shareReplay, switchMap, tap } from 'rxjs';

import { ArticlePublicationService, ContentRefreshOperation } from './article-publication.service';
import { LoginService } from './login.service';
import { SettingsService } from './settings.service';
import { UsersService } from './users.service';

interface CategoryLookupRow {
  id?: number | null;
  name?: string | null;
  description?: string | null;
  descricao?: string | null;
  created_at?: string | null;
  created_by?: number | null;
  updated_at?: string | null;
  updated_by?: number | null;
}

type CategoryDescriptionField = 'description' | 'descricao' | null;

export interface CategoryListItem {
  id: number;
  name: string;
  description: string;
}

export interface CategoryUpsertPayload {
  name: string;
  description: string;
}

@Injectable({
  providedIn: 'root',
})
export class CategoriesService {
  private readonly CATEGORIES_URL = 'https://wwwntzwmvjvivputmlqg.supabase.co/rest/v1/categories';
  private readonly ANON_KEY = 'sb_publishable_EREcwSKRXkRIRknqHOMh0g_FyIU7He0';
  private readonly FALLBACK_ACTOR_ID = 10447;

  private categoriesCache$?: Observable<CategoryListItem[]>;
  private descriptionField: CategoryDescriptionField | undefined;

  constructor(
    private readonly http: HttpClient,
    private readonly loginService: LoginService,
    private readonly usersService: UsersService,
    private readonly articlePublicationService: ArticlePublicationService,
    private readonly settingsService: SettingsService,
  ) {}

  getCategories(forceRefresh = false): Observable<CategoryListItem[]> {
    if (forceRefresh) {
      this.categoriesCache$ = undefined;
    }

    if (this.categoriesCache$) {
      return this.categoriesCache$;
    }

    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', '*')
      .set('order', 'id.asc');

    this.categoriesCache$ = this.http.get<CategoryLookupRow[]>(this.CATEGORIES_URL, { headers, params }).pipe(
      map((rows) => this.mapCategoryRows(rows)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    return this.categoriesCache$;
  }

  getCategoryById(categoryId: number): Observable<CategoryListItem | null> {
    const normalizedCategoryId = this.parseNumber(categoryId);
    if (normalizedCategoryId === null || normalizedCategoryId <= 0) {
      return of(null);
    }

    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', '*')
      .set('id', `eq.${normalizedCategoryId}`)
      .set('limit', '1');

    return this.http.get<CategoryLookupRow[]>(this.CATEGORIES_URL, { headers, params }).pipe(
      map((rows) => {
        const [row] = Array.isArray(rows) ? rows : [];
        return this.mapCategory(row);
      }),
    );
  }

  createCategory(payload: CategoryUpsertPayload): Observable<CategoryListItem> {
    return this.getCurrentActorId().pipe(
      switchMap((actorId) => {
        const headers = this.getAuthHeaders()
          .set('Content-Type', 'application/json')
          .set('Prefer', 'missing=default, return=representation');
        const params = new HttpParams().set('select', '*');

        return this.http.post<CategoryLookupRow[]>(
          this.CATEGORIES_URL,
          this.mapNewCategoryPayload(payload, actorId),
          { headers, params },
        );
      }),
      map((rows) => this.extractCategory(rows)),
      switchMap((category) => this.queueCategoryRefresh('create', category.id).pipe(map(() => category))),
      tap(() => {
        this.categoriesCache$ = undefined;
      }),
    );
  }

  updateCategory(categoryId: number, payload: CategoryUpsertPayload): Observable<CategoryListItem> {
    return this.getCurrentActorId().pipe(
      switchMap((actorId) => {
        const headers = this.getAuthHeaders()
          .set('Content-Type', 'application/json')
          .set('Prefer', 'return=representation');
        const params = new HttpParams()
          .set('id', `eq.${categoryId}`)
          .set('select', '*');

        return this.http.patch<CategoryLookupRow[]>(
          this.CATEGORIES_URL,
          this.mapCategoryPayload(payload, actorId),
          { headers, params },
        );
      }),
      map((rows) => this.extractCategory(rows)),
      switchMap((category) => this.queueCategoryRefresh('update', category.id).pipe(map(() => category))),
      tap(() => {
        this.categoriesCache$ = undefined;
      }),
    );
  }

  deleteCategory(categoryId: number): Observable<void> {
    const headers = this.getAuthHeaders().set('Prefer', 'return=minimal');
    const params = new HttpParams().set('id', `eq.${categoryId}`);

    return this.http.delete<null>(this.CATEGORIES_URL, { headers, params }).pipe(
      switchMap(() => this.queueCategoryRefresh('delete', categoryId)),
      tap(() => {
        this.categoriesCache$ = undefined;
      }),
      map(() => void 0),
    );
  }

  private queueCategoryRefresh(operation: ContentRefreshOperation, categoryId: number | null): Observable<void> {
    return this.settingsService.getSettings().pipe(
      switchMap((settings) => {
        if (!settings.articlesEnabled) {
          return of(void 0);
        }

        return this.articlePublicationService.dispatchContentRefresh({
          entityType: 'category',
          entityId: categoryId,
          operation,
          updatedAt: new Date().toISOString(),
        });
      }),
      catchError((error: unknown) => {
        console.warn('Nao foi possivel acionar a Action apos alterar categoria:', error);
        return of(void 0);
      }),
    );
  }

  private getAuthHeaders(): HttpHeaders {
    const accessToken = this.loginService.requireAccessToken();

    return new HttpHeaders({
      apikey: this.ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    });
  }

  private mapCategoryRows(rows: CategoryLookupRow[] | null | undefined): CategoryListItem[] {
    return (Array.isArray(rows) ? rows : [])
      .map((row) => this.mapCategory(row))
      .filter((category): category is CategoryListItem => category !== null);
  }

  private mapCategory(row: CategoryLookupRow | undefined): CategoryListItem | null {
    this.syncDescriptionField(row);

    const categoryId = this.parseNumber(row?.id);
    if (categoryId === null) {
      return null;
    }

    return {
      id: categoryId,
      name: this.parseText(row?.name, 'Categoria sem nome'),
      description: this.resolveDescription(row),
    };
  }

  private resolveDescription(row: CategoryLookupRow | undefined): string {
    if (!row) {
      return '';
    }

    if (this.descriptionField === 'description') {
      return this.parseText(row.description);
    }

    if (this.descriptionField === 'descricao') {
      return this.parseText(row.descricao);
    }

    return '';
  }

  private syncDescriptionField(row: CategoryLookupRow | undefined): void {
    if (!row || this.descriptionField !== undefined) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(row, 'description')) {
      this.descriptionField = 'description';
      return;
    }

    if (Object.prototype.hasOwnProperty.call(row, 'descricao')) {
      this.descriptionField = 'descricao';
      return;
    }

    this.descriptionField = null;
  }

  private mapNewCategoryPayload(payload: CategoryUpsertPayload, actorId: number): Record<string, unknown> {
    const timestamp = new Date().toISOString();

    return {
      ...this.mapCategoryPayload(payload, actorId),
      created_at: timestamp,
      created_by: actorId,
      updated_at: timestamp,
      updated_by: actorId,
    };
  }

  private mapCategoryPayload(payload: CategoryUpsertPayload, actorId: number): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
      name: payload.name.trim(),
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    };

    const descriptionField = this.descriptionField === undefined ? 'description' : this.descriptionField;

    if (descriptionField === 'description') {
      requestBody['description'] = payload.description.trim();
    }

    if (descriptionField === 'descricao') {
      requestBody['descricao'] = payload.description.trim();
    }

    return requestBody;
  }

  private getCurrentActorId(): Observable<number> {
    return this.usersService.getCurrentUserId(this.FALLBACK_ACTOR_ID);
  }

  private extractCategory(rows: CategoryLookupRow[] | null | undefined): CategoryListItem {
    const [row] = Array.isArray(rows) ? rows : [];
    const category = this.mapCategory(row);

    if (!category) {
      throw new Error('A API nao retornou a categoria salva.');
    }

    return category;
  }

  private parseText(value: unknown, fallback = ''): string {
    if (typeof value !== 'string') {
      return fallback;
    }

    const normalized = value.trim();
    return normalized || fallback;
  }

  private parseNumber(value: unknown): number | null {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return null;
    }

    return value;
  }
}
