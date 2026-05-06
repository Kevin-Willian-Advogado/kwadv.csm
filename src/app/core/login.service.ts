import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface SupabaseAuthResponse {
  access_token: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  token_type: string;
  user: SupabaseAuthUser;
}

export interface SupabaseAuthUser {
  email?: string;
  [key: string]: unknown;
}

export interface CurrentAuthIdentity {
  email: string | null;
  displayName: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class LoginService {
  private readonly ACCESS_TOKEN_KEY = 'access_token';
  private readonly AUTH_USER_KEY = 'auth_user';
  private readonly EXPIRES_AT_KEY = 'auth_expires_at';
  private readonly AUTH_URL =
    'https://wwwntzwmvjvivputmlqg.supabase.co/auth/v1/token?grant_type=password';

  private readonly API_KEY = 'sb_publishable_EREcwSKRXkRIRknqHOMh0g_FyIU7He0';

  constructor(private readonly http: HttpClient) {}

  login(payload: LoginPayload): Observable<SupabaseAuthResponse> {
    const headers = new HttpHeaders({
      apikey: this.API_KEY,
      Authorization: `Bearer ${this.API_KEY}`,
      'Content-Type': 'application/json',
    });

    return this.http.post<SupabaseAuthResponse>(this.AUTH_URL, payload, { headers });
  }

  persistSession(response: SupabaseAuthResponse): void {
    localStorage.setItem(this.ACCESS_TOKEN_KEY, response.access_token);
    localStorage.setItem(this.AUTH_USER_KEY, JSON.stringify(response.user ?? {}));
    localStorage.setItem(this.EXPIRES_AT_KEY, String(response.expires_at));
  }

  clearSession(): void {
    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    localStorage.removeItem(this.AUTH_USER_KEY);
    localStorage.removeItem(this.EXPIRES_AT_KEY);
  }

  getAccessToken(): string | null {
    const accessToken = localStorage.getItem(this.ACCESS_TOKEN_KEY);
    if (!accessToken) {
      return null;
    }

    if (this.isAccessTokenExpired(accessToken)) {
      this.clearSession();
      return null;
    }

    return accessToken;
  }

  requireAccessToken(): string {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      throw new Error('Sessao expirada. Faca login novamente.');
    }

    return accessToken;
  }

  isAuthenticated(): boolean {
    return this.getAccessToken() !== null;
  }

  getCurrentUserEmail(): string | null {
    return this.getCurrentAuthIdentity().email;
  }

  getCurrentAuthIdentity(): CurrentAuthIdentity {
    const storedUser = this.getStoredUser();
    const storedEmail = this.normalizeEmail(storedUser?.email);
    const payload = this.decodeAccessTokenPayload();
    const payloadEmail = this.normalizeEmail(payload?.['email']);

    return {
      email: storedEmail ?? payloadEmail,
      displayName:
        this.extractDisplayName(storedUser) ??
        this.extractDisplayName(payload?.['user_metadata']) ??
        this.extractText(payload?.['name']) ??
        this.extractText(payload?.['full_name']),
    };
  }

  private getStoredUser(): SupabaseAuthUser | null {
    const rawValue = localStorage.getItem(this.AUTH_USER_KEY);
    if (!rawValue) {
      return null;
    }

    try {
      return JSON.parse(rawValue) as SupabaseAuthUser;
    } catch {
      return null;
    }
  }

  private decodeAccessTokenPayload(): Record<string, unknown> | null {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return null;
    }

    const tokenParts = accessToken.split('.');
    if (tokenParts.length < 2) {
      return null;
    }

    try {
      const payload = tokenParts[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(tokenParts[1].length / 4) * 4, '=');

      return JSON.parse(atob(payload)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private isAccessTokenExpired(accessToken: string): boolean {
    const expirationFromStorage = this.parseNumericDate(localStorage.getItem(this.EXPIRES_AT_KEY));
    const expirationFromToken = this.parseNumericDate(this.decodeTokenWithoutSessionCheck(accessToken)?.['exp']);
    const expiresAt = expirationFromStorage ?? expirationFromToken;

    if (expiresAt === null) {
      return false;
    }

    const clockSkewSeconds = 30;
    return expiresAt <= Math.floor(Date.now() / 1000) + clockSkewSeconds;
  }

  private decodeTokenWithoutSessionCheck(accessToken: string): Record<string, unknown> | null {
    const tokenParts = accessToken.split('.');
    if (tokenParts.length < 2) {
      return null;
    }

    try {
      const payload = tokenParts[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(tokenParts[1].length / 4) * 4, '=');

      return JSON.parse(atob(payload)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private parseNumericDate(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private normalizeEmail(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    return normalized || null;
  }

  private extractDisplayName(value: unknown): string | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const record = value as Record<string, unknown>;
    return (
      this.extractText(record['full_name']) ??
      this.extractText(record['name']) ??
      this.extractText(record['display_name'])
    );
  }

  private extractText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized || null;
  }
}
