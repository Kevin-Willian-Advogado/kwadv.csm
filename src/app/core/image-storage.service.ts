import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { map, Observable, of, throwError } from 'rxjs';

import { LoginService } from './login.service';

@Injectable({
  providedIn: 'root',
})
export class ImageStorageService {
  private readonly SUPABASE_URL = 'https://wwwntzwmvjvivputmlqg.supabase.co';
  private readonly BUCKET_NAME = 'images';
  private readonly ANON_KEY = 'sb_publishable_EREcwSKRXkRIRknqHOMh0g_FyIU7He0';
  private readonly MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
  private readonly ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ]);

  constructor(
    private readonly http: HttpClient,
    private readonly loginService: LoginService,
  ) {}

  uploadAuthorImage(file: File, authorId: number | null): Observable<string> {
    const validationMessage = this.validateImageFile(file);
    if (validationMessage) {
      return throwError(() => new Error(validationMessage));
    }

    const storagePath = this.buildAuthorImagePath(file, authorId);
    const uploadUrl = `${this.SUPABASE_URL}/storage/v1/object/${this.BUCKET_NAME}/${this.encodeStoragePath(storagePath)}`;
    const headers = this.getUploadHeaders(file);

    return this.http.post<unknown>(uploadUrl, file, { headers }).pipe(
      map(() => this.getPublicImageUrl(storagePath)),
    );
  }

  uploadArticleCoverImage(file: File, articleId: number | null): Observable<string> {
    const validationMessage = this.validateImageFile(file);
    if (validationMessage) {
      return throwError(() => new Error(validationMessage));
    }

    const storagePath = this.buildArticleCoverImagePath(file, articleId);
    const uploadUrl = `${this.SUPABASE_URL}/storage/v1/object/${this.BUCKET_NAME}/${this.encodeStoragePath(storagePath)}`;
    const headers = this.getUploadHeaders(file);

    return this.http.post<unknown>(uploadUrl, file, { headers }).pipe(
      map(() => this.getPublicImageUrl(storagePath)),
    );
  }

  deleteImageByPublicUrl(imageUrl: string): Observable<void> {
    const storagePath = this.extractStoragePathFromUrl(imageUrl);
    if (!storagePath) {
      return of(void 0);
    }

    const deleteUrl = `${this.SUPABASE_URL}/storage/v1/object/${this.BUCKET_NAME}/${this.encodeStoragePath(storagePath)}`;

    return this.http.delete<unknown>(deleteUrl, { headers: this.getAuthHeaders() }).pipe(
      map(() => void 0),
    );
  }

  private getUploadHeaders(file: File): HttpHeaders {
    return this.getAuthHeaders()
      .set('Cache-Control', '3600')
      .set('Content-Type', file.type || 'application/octet-stream')
      .set('x-upsert', 'true');
  }

  private getAuthHeaders(): HttpHeaders {
    const accessToken = this.loginService.requireAccessToken();

    return new HttpHeaders({
      apikey: this.ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    });
  }

  private validateImageFile(file: File): string {
    if (!this.ALLOWED_MIME_TYPES.has(file.type)) {
      return 'Use uma imagem PNG, JPG, WEBP ou GIF.';
    }

    if (file.size > this.MAX_IMAGE_SIZE_BYTES) {
      return 'Use uma imagem de ate 10 MB.';
    }

    return '';
  }

  private buildAuthorImagePath(file: File, authorId: number | null): string {
    const ownerFolder = typeof authorId === 'number' && authorId > 0 ? String(authorId) : 'rascunhos';
    const fileName = [
      this.createTimestamp(),
      this.createUniqueSuffix(),
      this.sanitizeBaseName(file.name),
    ].join('-');

    return `authors/${ownerFolder}/${fileName}.${this.getExtension(file.type)}`;
  }

  private buildArticleCoverImagePath(file: File, articleId: number | null): string {
    const ownerFolder = typeof articleId === 'number' && articleId > 0 ? String(articleId) : 'rascunhos';
    const fileName = [
      this.createTimestamp(),
      this.createUniqueSuffix(),
      this.sanitizeBaseName(file.name),
    ].join('-');

    return `articles/${ownerFolder}/cover/${fileName}.${this.getExtension(file.type)}`;
  }

  private getPublicImageUrl(storagePath: string): string {
    return `${this.SUPABASE_URL}/storage/v1/object/public/${this.BUCKET_NAME}/${this.encodeStoragePath(storagePath)}`;
  }

  private extractStoragePathFromUrl(imageUrl: string): string | null {
    const normalizedImageUrl = imageUrl.trim();
    if (!normalizedImageUrl) {
      return null;
    }

    try {
      const url = new URL(normalizedImageUrl);
      const supabaseUrl = new URL(this.SUPABASE_URL);
      const publicPathPrefix = `/storage/v1/object/public/${this.BUCKET_NAME}/`;
      const objectPathPrefix = `/storage/v1/object/${this.BUCKET_NAME}/`;
      const matchingPrefix = url.pathname.startsWith(publicPathPrefix)
        ? publicPathPrefix
        : url.pathname.startsWith(objectPathPrefix)
          ? objectPathPrefix
          : null;

      if (url.origin !== supabaseUrl.origin || matchingPrefix === null) {
        return null;
      }

      const encodedPath = url.pathname.slice(matchingPrefix.length);
      return encodedPath
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/');
    } catch {
      return null;
    }
  }

  private encodeStoragePath(storagePath: string): string {
    return storagePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  }

  private createTimestamp(): string {
    return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  }

  private createUniqueSuffix(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return Math.random().toString(36).slice(2, 10);
  }

  private sanitizeBaseName(fileName: string): string {
    const extensionlessName = fileName.replace(/\.[^/.]+$/, '');
    const normalizedName = extensionlessName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return normalizedName || 'imagem';
  }

  private getExtension(mimeType: string): string {
    if (mimeType === 'image/jpeg') {
      return 'jpg';
    }

    if (mimeType === 'image/png') {
      return 'png';
    }

    if (mimeType === 'image/webp') {
      return 'webp';
    }

    if (mimeType === 'image/gif') {
      return 'gif';
    }

    return 'bin';
  }
}
