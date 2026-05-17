import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { LoginService } from './login.service';

export type ArticlePublicationAction = 'publish' | 'unpublish';
export type ContentRefreshEntityType = 'article' | 'author' | 'category';
export type ContentRefreshOperation = 'create' | 'update' | 'delete' | 'draft';

export interface ArticlePublicationRequest {
  articleId: number;
  articleSlug: string;
  action: ArticlePublicationAction;
  actorId: number | null;
  updatedAt: string | null;
}

export interface ContentRefreshRequest {
  entityType: ContentRefreshEntityType;
  entityId: number | null;
  operation: ContentRefreshOperation;
  actorId?: number | null;
  updatedAt?: string | null;
}

interface ArticlePublicationResponse {
  mensagem?: string;
  data?: unknown;
  error?: string;
  erro?: string;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ArticlePublicationService {
  private readonly SUPABASE_URL = 'https://wwwntzwmvjvivputmlqg.supabase.co';
  private readonly FUNCTION_URL = `${this.SUPABASE_URL}/functions/v1/publicar-artigo`;
  private readonly ANON_KEY = 'sb_publishable_EREcwSKRXkRIRknqHOMh0g_FyIU7He0';

  constructor(
    private readonly http: HttpClient,
    private readonly loginService: LoginService,
  ) {}

  dispatchPublication(request: ArticlePublicationRequest): Observable<void> {
    const headers = this.getAuthHeaders().set('Content-Type', 'application/json');

    return this.http
      .post<ArticlePublicationResponse>(this.FUNCTION_URL, request, { headers })
      .pipe(map(() => void 0));
  }

  dispatchContentRefresh(request: ContentRefreshRequest): Observable<void> {
    const headers = this.getAuthHeaders().set('Content-Type', 'application/json');

    return this.http
      .post<ArticlePublicationResponse>(
        this.FUNCTION_URL,
        {
          action: 'publish',
          entityType: request.entityType,
          entityId: request.entityId,
          operation: request.operation,
          actorId: request.actorId ?? null,
          updatedAt: request.updatedAt ?? new Date().toISOString(),
        },
        { headers },
      )
      .pipe(map(() => void 0));
  }

  private getAuthHeaders(): HttpHeaders {
    const accessToken = this.loginService.requireAccessToken();

    return new HttpHeaders({
      apikey: this.ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    });
  }
}
