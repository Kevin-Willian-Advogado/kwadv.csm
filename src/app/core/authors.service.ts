import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, map, Observable, of, shareReplay, switchMap, tap } from 'rxjs';
import { ArticleEditorAuthor } from './articles.service';
import { ArticlePublicationService, ContentRefreshOperation } from './article-publication.service';
import { CurrentAuthIdentity, LoginService } from './login.service';
import { SettingsService } from './settings.service';
import { UsersService } from './users.service';

interface AuthorLookupRow {
  id?: number | null;
  name?: string | null;
  headline?: string | null;
  profile_image_url?: string | null;
  user_id?: number | null;
  linkedin_url?: string | null;
  website_url?: string | null;
  created_at?: string | null;
  created_by?: number | null;
  updated_at?: string | null;
  updated_by?: number | null;
}

export interface AuthorListItem {
  id: number;
  name: string;
  headline: string;
  profileImageUrl: string;
  linkedinUrl: string;
  websiteUrl: string;
  userId: number | null;
}

export interface AuthorUpsertPayload {
  name: string;
  headline: string;
  profileImageUrl: string;
  linkedinUrl: string;
  websiteUrl: string;
  userId: number | null;
}

export interface CurrentAuthorContext {
  userId: number | null;
  author: ArticleEditorAuthor | null;
}

@Injectable({
  providedIn: 'root',
})
export class AuthorsService {
  private readonly AUTHORS_URL = 'https://wwwntzwmvjvivputmlqg.supabase.co/rest/v1/authors';
  private readonly ARTICLE_AUTHORS_URL = 'https://wwwntzwmvjvivputmlqg.supabase.co/rest/v1/article_author';
  private readonly ANON_KEY = 'sb_publishable_EREcwSKRXkRIRknqHOMh0g_FyIU7He0';
  private readonly FALLBACK_ACTOR_ID = 10447;
  private authorsCache$?: Observable<ArticleEditorAuthor[]>;
  private authorsListCache$?: Observable<AuthorListItem[]>;

  constructor(
    private readonly http: HttpClient,
    private readonly loginService: LoginService,
    private readonly usersService: UsersService,
    private readonly articlePublicationService: ArticlePublicationService,
    private readonly settingsService: SettingsService,
  ) {}

  getAuthors(forceRefresh = false): Observable<ArticleEditorAuthor[]> {
    if (forceRefresh) {
      this.authorsCache$ = undefined;
      this.authorsListCache$ = undefined;
    }

    if (this.authorsCache$) {
      return this.authorsCache$;
    }

    this.authorsCache$ = this.getAuthorsForListing(forceRefresh).pipe(
      map((authors) =>
        authors.map((author) => ({
          id: author.id,
          name: author.name,
          headline: author.headline,
          profileImageUrl: author.profileImageUrl,
        })),
      ),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    return this.authorsCache$;
  }

  getAuthorsForListing(forceRefresh = false): Observable<AuthorListItem[]> {
    if (forceRefresh) {
      this.authorsListCache$ = undefined;
      this.authorsCache$ = undefined;
    }

    if (this.authorsListCache$) {
      return this.authorsListCache$;
    }

    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', 'id,name,headline,profile_image_url,linkedin_url,website_url,user_id')
      .set('order', 'id.asc');

    this.authorsListCache$ = this.http.get<AuthorLookupRow[]>(this.AUTHORS_URL, { headers, params }).pipe(
      map((rows) =>
        (Array.isArray(rows) ? rows : [])
          .map((row) => this.mapAuthorForListing(row))
          .filter((author): author is AuthorListItem => author !== null),
      ),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    return this.authorsListCache$;
  }

  getAuthorById(authorId: number): Observable<AuthorListItem | null> {
    const normalizedAuthorId = this.parseNumber(authorId);
    if (normalizedAuthorId === null || normalizedAuthorId <= 0) {
      return of(null);
    }

    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', 'id,name,headline,profile_image_url,linkedin_url,website_url,user_id')
      .set('id', `eq.${normalizedAuthorId}`)
      .set('limit', '1');

    return this.http.get<AuthorLookupRow[]>(this.AUTHORS_URL, { headers, params }).pipe(
      map((rows) => {
        const [row] = Array.isArray(rows) ? rows : [];
        return this.mapAuthorForListing(row);
      }),
    );
  }

  createAuthor(payload: AuthorUpsertPayload): Observable<AuthorListItem> {
    return this.getCurrentActorId().pipe(
      switchMap((actorId) => {
        const headers = this.getAuthHeaders()
          .set('Content-Type', 'application/json')
          .set('Prefer', 'missing=default, return=representation');
        const params = new HttpParams().set('select', 'id,name,headline,profile_image_url,linkedin_url,website_url,user_id');

        return this.http.post<AuthorLookupRow[]>(
          this.AUTHORS_URL,
          this.mapNewAuthorPayload(payload, actorId),
          { headers, params },
        );
      }),
      map((rows) => this.extractAuthor(rows)),
      switchMap((author) => this.queueAuthorRefresh('create', author.id).pipe(map(() => author))),
      tap(() => {
        this.authorsCache$ = undefined;
        this.authorsListCache$ = undefined;
      }),
    );
  }

  updateAuthor(authorId: number, payload: AuthorUpsertPayload): Observable<AuthorListItem> {
    return this.getCurrentActorId().pipe(
      switchMap((actorId) => {
        const headers = this.getAuthHeaders()
          .set('Content-Type', 'application/json')
          .set('Prefer', 'return=representation');
        const params = new HttpParams()
          .set('id', `eq.${authorId}`)
          .set('select', 'id,name,headline,profile_image_url,linkedin_url,website_url,user_id');

        return this.http.patch<AuthorLookupRow[]>(
          this.AUTHORS_URL,
          this.mapAuthorPayload(payload, actorId),
          { headers, params },
        );
      }),
      map((rows) => this.extractAuthor(rows)),
      switchMap((author) => this.queueAuthorRefresh('update', author.id).pipe(map(() => author))),
      tap(() => {
        this.authorsCache$ = undefined;
        this.authorsListCache$ = undefined;
      }),
    );
  }

  deleteAuthor(authorId: number): Observable<void> {
    const headers = this.getAuthHeaders().set('Prefer', 'return=minimal');
    const params = new HttpParams().set('id', `eq.${authorId}`);

    return this.http.delete<null>(this.AUTHORS_URL, { headers, params }).pipe(
      switchMap(() => this.queueAuthorRefresh('delete', authorId)),
      tap(() => {
        this.authorsCache$ = undefined;
        this.authorsListCache$ = undefined;
      }),
      map(() => void 0),
    );
  }

  private queueAuthorRefresh(operation: ContentRefreshOperation, authorId: number | null): Observable<void> {
    return this.settingsService.getSettings().pipe(
      switchMap((settings) => {
        if (!settings.articlesEnabled) {
          return of(void 0);
        }

        return this.articlePublicationService.dispatchContentRefresh({
          entityType: 'author',
          entityId: authorId,
          operation,
          updatedAt: new Date().toISOString(),
        });
      }),
      catchError((error: unknown) => {
        console.warn('Nao foi possivel acionar a Action apos alterar autor:', error);
        return of(void 0);
      }),
    );
  }

  setAuthorUserLink(authorId: number, userId: number | null): Observable<void> {
    return this.getCurrentActorId().pipe(
      switchMap((actorId) => {
        const headers = this.getAuthHeaders()
          .set('Content-Type', 'application/json')
          .set('Prefer', 'return=minimal');
        const params = new HttpParams().set('id', `eq.${authorId}`);

        return this.http.patch<null>(
          this.AUTHORS_URL,
          {
            user_id: userId,
            updated_at: new Date().toISOString(),
            updated_by: actorId,
          },
          { headers, params },
        );
      }),
      tap(() => {
        this.authorsCache$ = undefined;
        this.authorsListCache$ = undefined;
      }),
      map(() => void 0),
    );
  }

  getArticleCountByAuthorId(authorId: number): Observable<number> {
    const normalizedAuthorId = this.parseNumber(authorId);
    if (normalizedAuthorId === null || normalizedAuthorId <= 0) {
      return of(0);
    }

    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', 'articles_id')
      .set('authors_id', `eq.${normalizedAuthorId}`);

    return this.http.get<Array<{ articles_id?: number | null }>>(this.ARTICLE_AUTHORS_URL, { headers, params }).pipe(
      map((rows) => Array.isArray(rows) ? rows.length : 0),
      catchError(() => of(0)),
    );
  }

  getCurrentAuthorContext(): Observable<CurrentAuthorContext> {
    const identity = this.loginService.getCurrentAuthIdentity();
    if (!identity.email) {
      return of({ userId: null, author: null });
    }

    return this.usersService.getUserByEmail(identity.email).pipe(
      map((user) => user?.id ?? null),
      switchMap((userId) =>
        this.resolveCurrentAuthor(userId, identity).pipe(
          map((author) => ({
            userId,
            author,
          })),
        ),
      ),
    );
  }

  private resolveCurrentAuthor(userId: number | null, identity: CurrentAuthIdentity): Observable<ArticleEditorAuthor | null> {
    if (userId === null) {
      return this.getBestAuthorMatch(identity);
    }

    return this.getAuthorByUserId(userId).pipe(
      switchMap((author) => {
        if (author) {
          return of(author);
        }

        return this.getBestAuthorMatch(identity).pipe(
          switchMap((matchedAuthor) => {
            if (!matchedAuthor) {
              return of(null);
            }

            return this.setAuthorUserLink(matchedAuthor.id, userId).pipe(
              map(() => matchedAuthor),
              catchError(() => of(matchedAuthor)),
            );
          }),
        );
      }),
    );
  }

  private getAuthorByUserId(userId: number): Observable<ArticleEditorAuthor | null> {
    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', 'id,name,headline,profile_image_url,linkedin_url,website_url,user_id')
      .set('user_id', `eq.${userId}`)
      .set('limit', '1');

    return this.http.get<AuthorLookupRow[]>(this.AUTHORS_URL, { headers, params }).pipe(
      map((rows) => {
        if (!Array.isArray(rows) || rows.length === 0) {
          return null;
        }

        return this.mapAuthor(rows[0]);
      }),
    );
  }

  private getBestAuthorMatch(identity: CurrentAuthIdentity): Observable<ArticleEditorAuthor | null> {
    return this.getAuthors().pipe(
      map((authors) => this.findBestAuthorMatch(authors, identity)),
    );
  }

  private getAuthHeaders(): HttpHeaders {
    const accessToken = this.loginService.requireAccessToken();

    return new HttpHeaders({
      apikey: this.ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    });
  }

  private mapAuthor(row: AuthorLookupRow | undefined): ArticleEditorAuthor | null {
    const author = this.mapAuthorForListing(row);
    if (!author) {
      return null;
    }

    return {
      id: author.id,
      name: author.name,
      headline: author.headline,
      profileImageUrl: author.profileImageUrl,
    };
  }

  private mapAuthorForListing(row: AuthorLookupRow | undefined): AuthorListItem | null {
    const authorId = this.parseNumber(row?.id);
    if (authorId === null) {
      return null;
    }

    return {
      id: authorId,
      name: this.parseText(row?.name, 'Autor sem nome'),
      headline: this.parseText(row?.headline),
      profileImageUrl: this.parseText(row?.profile_image_url),
      linkedinUrl: this.parseText(row?.linkedin_url),
      websiteUrl: this.parseText(row?.website_url),
      userId: this.parseNumber(row?.user_id),
    };
  }

  private mapNewAuthorPayload(payload: AuthorUpsertPayload, actorId: number): Record<string, unknown> {
    const timestamp = new Date().toISOString();

    return {
      ...this.mapAuthorPayload(payload, actorId),
      created_at: timestamp,
      created_by: actorId,
      updated_at: timestamp,
      updated_by: actorId,
    };
  }

  private mapAuthorPayload(payload: AuthorUpsertPayload, actorId: number): Record<string, unknown> {
    return {
      name: payload.name.trim(),
      headline: payload.headline.trim(),
      profile_image_url: payload.profileImageUrl.trim(),
      linkedin_url: payload.linkedinUrl.trim(),
      website_url: payload.websiteUrl.trim(),
      user_id: payload.userId,
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    };
  }

  private extractAuthor(rows: AuthorLookupRow[] | null | undefined): AuthorListItem {
    const [row] = Array.isArray(rows) ? rows : [];
    const author = this.mapAuthorForListing(row);

    if (!author) {
      throw new Error('A API nao retornou o autor salvo.');
    }

    return author;
  }

  private parseText(value: unknown, fallback = ''): string {
    if (typeof value !== 'string') {
      return fallback;
    }

    return value.trim();
  }

  private parseNumber(value: unknown): number | null {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return null;
    }

    return value;
  }

  private getCurrentActorId(): Observable<number> {
    return this.usersService.getCurrentUserId(this.FALLBACK_ACTOR_ID);
  }

  private findBestAuthorMatch(
    authors: ArticleEditorAuthor[],
    identity: CurrentAuthIdentity,
  ): ArticleEditorAuthor | null {
    const candidates = this.buildIdentityCandidates(identity);
    if (candidates.length === 0) {
      return null;
    }

    const rankedAuthors = authors
      .map((author) => ({
        author,
        score: Math.max(...candidates.map((candidate) => this.getAuthorMatchScore(author.name, candidate))),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.author.name.localeCompare(right.author.name));

    return rankedAuthors[0]?.author ?? null;
  }

  private buildIdentityCandidates(identity: CurrentAuthIdentity): string[] {
    const values = [
      identity.displayName,
      this.extractEmailLocalPart(identity.email),
    ];

    return Array.from(
      new Set(
        values
          .map((value) => this.normalizeForComparison(value))
          .filter((value): value is string => !!value),
      ),
    );
  }

  private getAuthorMatchScore(authorName: string, candidate: string): number {
    const normalizedAuthorName = this.normalizeForComparison(authorName);
    if (!normalizedAuthorName || !candidate) {
      return 0;
    }

    if (normalizedAuthorName === candidate) {
      return 100;
    }

    const candidateTokens = this.tokenize(candidate);
    const authorTokens = this.tokenize(normalizedAuthorName);
    const overlappingTokens = candidateTokens.filter((token) => authorTokens.includes(token));

    if (
      candidateTokens.length > 0 &&
      overlappingTokens.length === candidateTokens.length &&
      candidateTokens.length === authorTokens.length
    ) {
      return 90;
    }

    if (candidateTokens.length > 0 && overlappingTokens.length === candidateTokens.length) {
      return 80 + overlappingTokens.length;
    }

    if (normalizedAuthorName.includes(candidate) || candidate.includes(normalizedAuthorName)) {
      return 70;
    }

    if (overlappingTokens.length > 0) {
      return 50 + overlappingTokens.length;
    }

    return 0;
  }

  private extractEmailLocalPart(email: string | null): string | null {
    if (!email) {
      return null;
    }

    const [localPart] = email.split('@');
    if (!localPart) {
      return null;
    }

    return localPart.replace(/\d+/g, ' ');
  }

  private normalizeForComparison(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return normalized || null;
  }

  private tokenize(value: string): string[] {
    return value.split(' ').filter((token) => token.length > 1);
  }
}
