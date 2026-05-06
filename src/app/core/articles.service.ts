import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, map, Observable, of, shareReplay, switchMap, tap, throwError } from 'rxjs';

import { LoginService } from './login.service';

export interface ArticleEditorAuthor {
  id: number;
  name: string;
  headline: string;
  profileImageUrl: string;
}

export interface ArticleEditorRelatedArticle {
  id: number;
  title: string;
  subtitle: string;
  slug: string;
  coverImageUrl: string;
  categoryName: string;
}

export interface ArticleEditorCategory {
  id: number;
  name: string;
}

export interface ArticleEditorData {
  id: number;
  title: string;
  subtitle: string;
  slug: string;
  coverImageUrl: string;
  content: string;
  metaDescription: string;
  status: number;
  highlights: boolean;
  categoryId: number | null;
  categoryName: string;
  publishedAt: string | null;
  updatedAt: string | null;
  authors: ArticleEditorAuthor[];
  relatedArticles: ArticleEditorRelatedArticle[];
}

export interface ArticleUpsertPayload {
  title: string;
  subtitle: string;
  slug: string;
  coverImageUrl: string;
  content: string;
  metaDescription: string;
  categoryId: number | null;
  authorIds: number[];
  status: number;
  highlights: boolean;
  publishedAt: string | null;
  publishedBy?: number | null;
  views?: number | null;
  createdAt?: string | null;
  createdBy?: number | null;
  updatedAt?: string | null;
  updatedBy: number;
  relatedArticleIds: number[];
}

export interface ArticleListItem {
  id?: number;
  title?: string | null;
  subtitle?: string | null;
  slug?: string | null;
  status?: number | null;
  views?: number | null;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  categories?: { name?: string | null } | null;
}

export interface HighlightArticleItem {
  id?: number;
  title?: string | null;
  subtitle?: string | null;
  slug?: string | null;
  cover_image_url?: string | null;
  status?: number | null;
  highlights?: boolean | null;
  updated_at?: string | null;
  published_at?: string | null;
  categories?: { name?: string | null } | null;
}

@Injectable({
  providedIn: 'root',
})
export class ArticlesService {
  private readonly API_URL = 'https://wwwntzwmvjvivputmlqg.supabase.co/rest/v1/articles';
  private readonly ARTICLE_AUTHORS_URL = 'https://wwwntzwmvjvivputmlqg.supabase.co/rest/v1/article_author';
  private readonly ARTICLE_RELATED_URL = 'https://wwwntzwmvjvivputmlqg.supabase.co/rest/v1/article_related';
  private readonly CATEGORIES_URL = 'https://wwwntzwmvjvivputmlqg.supabase.co/rest/v1/categories';
  private readonly ANON_KEY = 'sb_publishable_EREcwSKRXkRIRknqHOMh0g_FyIU7He0';
  private readonly ARTICLE_DETAILS_SELECT =
    '*,authors(*),article_related!fk_article_related_links_articles_article_id(articles!fk_article_related_links_articles_related_articles_id(*,categories(*))),categories(*)';
  private readonly ARTICLE_LIST_SELECT = 'id,title,subtitle,slug,status,views,published_at,created_at,updated_at,categories(name)';
  private readonly RELATED_ARTICLES_SELECT = 'id,title,subtitle,slug,cover_image_url,status,published_at,updated_at,categories(name)';
  private readonly HIGHLIGHTS_SELECT =
    'id,title,subtitle,slug,cover_image_url,status,highlights,updated_at,published_at,categories(name)';
  private readonly LIST_CACHE_TTL_MS = 30_000;
  private readonly PUBLISHED_CACHE_TTL_MS = 30_000;
  private listArticlesCache$?: Observable<ArticleListItem[]>;
  private listArticlesCacheTimestamp = 0;
  private publishedArticlesCache$?: Observable<HighlightArticleItem[]>;
  private publishedArticlesCacheTimestamp = 0;

  constructor(
    private http: HttpClient,
    private readonly loginService: LoginService,
  ) {}

  private getAuthHeaders(): HttpHeaders {
    const accessToken = this.loginService.requireAccessToken();

    return new HttpHeaders({
      apikey: this.ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    });
  }

  getArticlesWithDetails(): Observable<any[]> {
    const headers = this.getAuthHeaders();

    const params = new HttpParams()
      .set('select', this.ARTICLE_DETAILS_SELECT)
      .set('order', 'published_at.desc');

    return this.http.get<any[]>(this.API_URL, { headers, params });
  }

  getArticlesForListing(forceRefresh = false): Observable<ArticleListItem[]> {
    const mustRefresh = forceRefresh || !this.hasFreshCache(this.listArticlesCacheTimestamp, this.LIST_CACHE_TTL_MS);
    if (mustRefresh) {
      this.listArticlesCache$ = undefined;
    }

    if (this.listArticlesCache$) {
      return this.listArticlesCache$;
    }

    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', this.ARTICLE_LIST_SELECT)
      .set('order', 'published_at.desc');

    this.listArticlesCache$ = this.http.get<ArticleListItem[]>(this.API_URL, { headers, params }).pipe(
      tap(() => {
        this.listArticlesCacheTimestamp = Date.now();
      }),
      catchError((error: unknown) => {
        this.listArticlesCache$ = undefined;
        this.listArticlesCacheTimestamp = 0;
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    return this.listArticlesCache$;
  }

  getArticlesForRelatedSelection(): Observable<ArticleEditorRelatedArticle[]> {
    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', this.RELATED_ARTICLES_SELECT)
      .set('status', 'eq.1')
      .set('order', 'updated_at.desc.nullslast');

    return this.http
      .get<
        Array<{
          id?: number | null;
          title?: string | null;
          subtitle?: string | null;
          slug?: string | null;
          cover_image_url?: string | null;
          categories?: { name?: string | null } | null;
        }>
      >(this.API_URL, { headers, params })
      .pipe(
        map((rows) =>
          rows
            .map((row) => ({
              id: this.parseNumber(row.id, 0),
              title: this.parseText(row.title, 'Sem titulo'),
              subtitle: this.parseText(row.subtitle),
              slug: this.parseText(row.slug),
              coverImageUrl: this.parseText(row.cover_image_url),
              categoryName: this.parseText(row.categories?.name, 'Sem categoria'),
            }))
            .filter((article) => article.id > 0 && article.slug.length > 0),
        ),
      );
  }

  getArticleBySlug(slug: string): Observable<ArticleEditorData | null> {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug) {
      return of(null);
    }

    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', this.ARTICLE_DETAILS_SELECT)
      .set('slug', `eq.${normalizedSlug}`)
      .set('limit', '1');

    return this.http.get<any[]>(this.API_URL, { headers, params }).pipe(
      map((rows) => {
        if (!Array.isArray(rows) || rows.length === 0) {
          return null;
        }

        return this.mapArticleEditorData(rows[0]);
      }),
    );
  }

  isSlugAvailable(slug: string, currentArticleId: number | null = null): Observable<boolean> {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug) {
      return of(false);
    }

    const headers = this.getAuthHeaders();
    let params = new HttpParams()
      .set('select', 'id')
      .set('slug', `eq.${normalizedSlug}`)
      .set('limit', '1');

    if (typeof currentArticleId === 'number' && currentArticleId > 0) {
      params = params.set('id', `neq.${currentArticleId}`);
    }

    return this.http.get<Array<{ id?: number | null }>>(this.API_URL, { headers, params }).pipe(
      map((rows) => !Array.isArray(rows) || rows.length === 0),
    );
  }

  getCategories(): Observable<ArticleEditorCategory[]> {
    const headers = this.getAuthHeaders();
    const params = new HttpParams().set('select', 'id,name').set('order', 'id.asc');

    return this.http
      .get<Array<{ id?: number; name?: string | null }>>(this.CATEGORIES_URL, { headers, params })
      .pipe(
        map((rows) =>
          rows.map((row) => ({
            id: this.parseNumber(row.id, 0),
            name: this.parseText(row.name),
          })),
        ),
      );
  }

  createArticle(payload: ArticleUpsertPayload): Observable<ArticleEditorData> {
    const headers = this.getAuthHeaders()
      .set('Content-Type', 'application/json')
      .set('Prefer', 'missing=default, return=representation');
    const params = new HttpParams().set('select', 'id');
    const requestBody = this.mapUpsertPayload(payload);

    return this.http.post<any[]>(this.API_URL, requestBody, { headers, params }).pipe(
      map((rows) => this.extractArticleId(rows)),
      switchMap((articleId) =>
        this.syncArticleAuthors(articleId, payload.authorIds).pipe(
          switchMap(() => this.syncArticleRelatedLinks(articleId, payload.relatedArticleIds)),
          switchMap(() => this.getArticleById(articleId)),
        ),
      ),
      tap(() => this.invalidateArticlesCache()),
    );
  }

  updateArticle(articleId: number, payload: ArticleUpsertPayload): Observable<ArticleEditorData> {
    const headers = this.getAuthHeaders()
      .set('Content-Type', 'application/json')
      .set('Prefer', 'return=representation');
    const params = new HttpParams()
      .set('id', `eq.${articleId}`)
      .set('select', 'id');
    const requestBody = this.mapUpsertPayload(payload);

    return this.http.patch<any[]>(this.API_URL, requestBody, { headers, params }).pipe(
      map((rows) => this.extractArticleId(rows)),
      switchMap((savedArticleId) =>
        this.syncArticleAuthors(savedArticleId, payload.authorIds).pipe(
          switchMap(() => this.syncArticleRelatedLinks(savedArticleId, payload.relatedArticleIds)),
          switchMap(() => this.getArticleById(savedArticleId)),
        ),
      ),
      tap(() => this.invalidateArticlesCache()),
    );
  }

  getPublishedArticles(forceRefresh = false): Observable<HighlightArticleItem[]> {
    const mustRefresh =
      forceRefresh || !this.hasFreshCache(this.publishedArticlesCacheTimestamp, this.PUBLISHED_CACHE_TTL_MS);
    if (mustRefresh) {
      this.publishedArticlesCache$ = undefined;
    }

    if (this.publishedArticlesCache$) {
      return this.publishedArticlesCache$;
    }

    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', this.HIGHLIGHTS_SELECT)
      .set('status', 'eq.1')
      .set('order', 'published_at.desc');

    this.publishedArticlesCache$ = this.http.get<HighlightArticleItem[]>(this.API_URL, { headers, params }).pipe(
      tap(() => {
        this.publishedArticlesCacheTimestamp = Date.now();
      }),
      catchError((error: unknown) => {
        this.publishedArticlesCache$ = undefined;
        this.publishedArticlesCacheTimestamp = 0;
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    return this.publishedArticlesCache$;
  }

  getHighlightedArticles(forceRefresh = false): Observable<HighlightArticleItem[]> {
    return this.getPublishedArticles(forceRefresh).pipe(
      map((articles) =>
        articles
          .filter((article) => article.highlights === true)
          .sort(
            (left, right) =>
              this.toTimestamp(right.updated_at) - this.toTimestamp(left.updated_at),
          ),
      ),
    );
  }

  updateArticleHighlight(articleId: number, highlight: boolean): Observable<null> {
    const headers = this.getAuthHeaders()
      .set('Content-Type', 'application/json')
      .set('Prefer', 'return=minimal');
    const params = new HttpParams().set('id', `eq.${articleId}`);

    return this.http
      .patch<null>(this.API_URL, { highlights: highlight }, { headers, params })
      .pipe(tap(() => this.invalidateArticlesCache()));
  }

  private extractArticleId(rows: unknown): number {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('A API nao retornou o artigo salvo.');
    }

    const articleId = this.parseNumber((rows[0] as { id?: number | null })?.id, 0);
    if (articleId <= 0) {
      throw new Error('A API nao retornou o identificador do artigo salvo.');
    }

    return articleId;
  }

  private mapUpsertPayload(payload: ArticleUpsertPayload): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
      title: payload.title,
      subtitle: payload.subtitle,
      slug: payload.slug,
      cover_image_url: payload.coverImageUrl,
      content: payload.content,
      meta_description: payload.metaDescription,
      category_id: payload.categoryId,
      status: payload.status,
      highlights: payload.highlights,
      published_at: payload.publishedAt,
      updated_at: payload.updatedAt,
      updated_by: payload.updatedBy,
    };

    if (typeof payload.publishedBy === 'number' && !Number.isNaN(payload.publishedBy) && payload.publishedBy > 0) {
      requestBody['published_by'] = payload.publishedBy;
    } else if (payload.publishedBy === null) {
      requestBody['published_by'] = null;
    }

    if (typeof payload.views === 'number' && !Number.isNaN(payload.views) && payload.views >= 0) {
      requestBody['views'] = payload.views;
    }

    if (typeof payload.createdAt === 'string' && payload.createdAt.trim()) {
      requestBody['created_at'] = payload.createdAt;
    }

    if (typeof payload.createdBy === 'number' && !Number.isNaN(payload.createdBy) && payload.createdBy > 0) {
      requestBody['created_by'] = payload.createdBy;
    }

    return requestBody;
  }

  private getArticleById(articleId: number): Observable<ArticleEditorData> {
    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', this.ARTICLE_DETAILS_SELECT)
      .set('id', `eq.${articleId}`)
      .set('limit', '1');

    return this.http.get<any[]>(this.API_URL, { headers, params }).pipe(
      map((rows) => {
        if (!Array.isArray(rows) || rows.length === 0) {
          throw new Error('Nao foi possivel recarregar o artigo salvo.');
        }

        return this.mapArticleEditorData(rows[0]);
      }),
    );
  }

  private syncArticleAuthors(articleId: number, authorIds: number[]): Observable<void> {
    const normalizedAuthorIds = Array.from(
      new Set(authorIds.filter((authorId) => typeof authorId === 'number' && !Number.isNaN(authorId) && authorId > 0)),
    );

    const deleteHeaders = this.getAuthHeaders().set('Prefer', 'return=minimal');
    const deleteParams = new HttpParams().set('articles_id', `eq.${articleId}`);

    return this.http.delete<null>(this.ARTICLE_AUTHORS_URL, { headers: deleteHeaders, params: deleteParams }).pipe(
      switchMap(() => {
        if (normalizedAuthorIds.length === 0) {
          return of(void 0);
        }

        const insertHeaders = this.getAuthHeaders()
          .set('Content-Type', 'application/json')
          .set('Prefer', 'return=minimal');
        const requestBody = normalizedAuthorIds.map((authorId) => ({
          articles_id: articleId,
          authors_id: authorId,
        }));

        return this.http.post<null>(this.ARTICLE_AUTHORS_URL, requestBody, { headers: insertHeaders }).pipe(
          map(() => void 0),
        );
      }),
    );
  }

  private syncArticleRelatedLinks(articleId: number, relatedArticleIds: number[]): Observable<void> {
    const normalizedRelatedArticleIds = Array.from(
      new Set(
        relatedArticleIds
          .filter((relatedArticleId) => typeof relatedArticleId === 'number' && !Number.isNaN(relatedArticleId))
          .filter((relatedArticleId) => relatedArticleId > 0 && relatedArticleId !== articleId),
      ),
    ).slice(0, 3);

    const deleteHeaders = this.getAuthHeaders().set('Prefer', 'return=minimal');
    const deleteParams = new HttpParams().set('article_id', `eq.${articleId}`);

    return this.http.delete<null>(this.ARTICLE_RELATED_URL, { headers: deleteHeaders, params: deleteParams }).pipe(
      switchMap(() => {
        if (normalizedRelatedArticleIds.length === 0) {
          return of(void 0);
        }

        const insertHeaders = this.getAuthHeaders()
          .set('Content-Type', 'application/json')
          .set('Prefer', 'return=minimal');
        const requestBody = normalizedRelatedArticleIds.map((relatedArticleId) => ({
          article_id: articleId,
          related_articles_id: relatedArticleId,
        }));

        return this.http.post<null>(this.ARTICLE_RELATED_URL, requestBody, { headers: insertHeaders }).pipe(
          map(() => void 0),
        );
      }),
    );
  }

  private mapArticleEditorData(raw: unknown): ArticleEditorData {
    const row = (raw ?? {}) as {
      id?: number;
      title?: string | null;
      subtitle?: string | null;
      slug?: string | null;
      cover_image_url?: string | null;
      content?: string | null;
      meta_description?: string | null;
      status?: number | null;
      highlights?: boolean | null;
      category_id?: number | null;
      published_at?: string | null;
      updated_at?: string | null;
      categories?: { name?: string | null } | null;
      authors?: Array<{
        id?: number;
        name?: string | null;
        headline?: string | null;
        profile_image_url?: string | null;
      }> | null;
      article_related?: Array<{
        articles?: {
          id?: number;
          title?: string | null;
          subtitle?: string | null;
        slug?: string | null;
        cover_image_url?: string | null;
        status?: number | null;
        categories?: { name?: string | null } | null;
      } | null;
      }> | null;
    };

    const authors = Array.isArray(row.authors) ? row.authors : [];
    const relatedArticles = Array.isArray(row.article_related) ? row.article_related : [];
    const relatedItems = relatedArticles
      .map((item) => item.articles)
      .filter((item): item is NonNullable<typeof item> => !!item)
      .filter((article) => this.parseNumber(article.status, 0) === 1);

    return {
      id: this.parseNumber(row.id, 0),
      title: this.parseText(row.title),
      subtitle: this.parseText(row.subtitle),
      slug: this.parseText(row.slug),
      coverImageUrl: this.parseText(row.cover_image_url),
      content: this.parseText(row.content),
      metaDescription: this.parseText(row.meta_description),
      status: this.parseNumber(row.status, 2),
      highlights: !!row.highlights,
      categoryId: this.parseNullableNumber(row.category_id),
      categoryName: this.parseText(row.categories?.name, 'Sem categoria'),
      publishedAt: this.parseNullableText(row.published_at),
      updatedAt: this.parseNullableText(row.updated_at),
      authors: authors.map((author) => ({
        id: this.parseNumber(author.id, 0),
        name: this.parseText(author.name),
        headline: this.parseText(author.headline),
        profileImageUrl: this.parseText(author.profile_image_url),
      })),
      relatedArticles: relatedItems.map((article) => ({
        id: this.parseNumber(article.id, 0),
        title: this.parseText(article.title),
        subtitle: this.parseText(article.subtitle),
        slug: this.parseText(article.slug),
        coverImageUrl: this.parseText(article.cover_image_url),
        categoryName: this.parseText(article.categories?.name, 'Sem categoria'),
      })),
    };
  }

  private parseText(value: unknown, fallback = ''): string {
    if (typeof value !== 'string') {
      return fallback;
    }

    return value.trim();
  }

  private parseNullableText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private parseNumber(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return fallback;
    }

    return value;
  }

  private parseNullableNumber(value: unknown): number | null {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return null;
    }

    return value;
  }

  private invalidateArticlesCache(): void {
    this.listArticlesCache$ = undefined;
    this.listArticlesCacheTimestamp = 0;
    this.publishedArticlesCache$ = undefined;
    this.publishedArticlesCacheTimestamp = 0;
  }

  private toTimestamp(value: string | null | undefined): number {
    if (typeof value !== 'string') {
      return 0;
    }

    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  private hasFreshCache(timestamp: number, ttlMs: number): boolean {
    if (timestamp <= 0) {
      return false;
    }

    return Date.now() - timestamp < ttlMs;
  }
}
