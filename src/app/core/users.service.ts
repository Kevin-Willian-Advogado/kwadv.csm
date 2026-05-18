import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, map, Observable, of, shareReplay, tap } from 'rxjs';

import { LoginService } from './login.service';

interface UserLookupRow {
  id?: number | null;
  auth_id?: string | null;
  auth_user_id?: string | null;
  email?: string | null;
  password_hash?: string | null;
  created_at?: string | null;
  created_by?: number | null;
  updated_at?: string | null;
  updated_by?: number | null;
  name?: string | null;
  full_name?: string | null;
  display_name?: string | null;
  active?: boolean | null;
  is_active?: boolean | null;
  status?: boolean | number | string | null;
}

export interface UserListItem {
  id: number;
  email: string;
  displayName: string;
  isActive: boolean | null;
  pendingEmail?: string | null;
  emailChangeValidationSent?: boolean;
  userSetupEmailSent?: boolean;
}

export interface UserUpsertPayload {
  email: string;
  displayName: string;
  isActive: boolean | null;
  passwordRedirectTo?: string;
  emailChangeRedirectTo?: string;
}

type ManageUserAction = 'list' | 'get' | 'create' | 'edit' | 'delete';

interface ManageUserFunctionPayload {
  acao: ManageUserAction;
  id?: number | string;
  userId?: number;
  email?: string;
  nome?: string;
  displayName?: string;
  status?: boolean;
  isActive?: boolean;
  passwordRedirectTo?: string;
  emailChangeRedirectTo?: string;
}

interface ManageUserFunctionResponse {
  mensagem?: string;
  data?: {
    users?: UserLookupRow[] | null;
    publicUser?: UserLookupRow | null;
    authUser?: {
      id?: string | null;
      email?: string | null;
    } | null;
    pendingEmail?: string | null;
    userEmailChangeValidationSent?: boolean | null;
    userSetupEmailSent?: boolean | null;
    userDefinitionEmailSent?: boolean | null;
  } | null;
  error?: string;
  erro?: string;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class UsersService {
  private readonly SUPABASE_URL = 'https://wwwntzwmvjvivputmlqg.supabase.co';
  private readonly MANAGE_USERS_FUNCTION_URL = `${this.SUPABASE_URL}/functions/v1/gerenciar-usuarios`;
  private readonly ANON_KEY = 'sb_publishable_EREcwSKRXkRIRknqHOMh0g_FyIU7He0';
  private readonly ROOT_USER_ID = 10447;

  private usersCache$?: Observable<UserListItem[]>;

  constructor(
    private readonly http: HttpClient,
    private readonly loginService: LoginService,
  ) {}

  getUsers(forceRefresh = false): Observable<UserListItem[]> {
    if (forceRefresh) {
      this.usersCache$ = undefined;
    }

    if (this.usersCache$) {
      return this.usersCache$;
    }

    this.usersCache$ = this.invokeManageUsersFunction({ acao: 'list' }).pipe(
      map((response) => {
        const users = (Array.isArray(response.data?.users) ? response.data?.users : [])
          .map((row) => this.mapUser(row))
          .filter((user): user is UserListItem => user !== null);

        return this.filterRootUserForCurrentSession(users);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    return this.usersCache$;
  }

  getUserById(userId: number): Observable<UserListItem | null> {
    const normalizedUserId = this.parseNumber(userId);
    if (normalizedUserId === null || normalizedUserId <= 0) {
      return of(null);
    }

    return this.invokeManageUsersFunction({ acao: 'get', id: normalizedUserId }).pipe(
      map((response) => this.mapUser(response.data?.publicUser ?? undefined)),
    );
  }

  getUserByEmail(email: string | null | undefined): Observable<UserListItem | null> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) {
      return of(null);
    }

    return this.invokeManageUsersFunction({ acao: 'get', email: normalizedEmail }).pipe(
      map((response) => this.mapUser(response.data?.publicUser ?? undefined)),
    );
  }

  getCurrentUserId(fallbackUserId: number): Observable<number> {
    const currentEmail = this.loginService.getCurrentUserEmail();
    if (!currentEmail) {
      return of(fallbackUserId);
    }

    return this.getUserByEmail(currentEmail).pipe(
      map((user) => user?.id ?? fallbackUserId),
      catchError(() => of(fallbackUserId)),
    );
  }

  createUser(payload: UserUpsertPayload): Observable<UserListItem> {
    return this.invokeManageUsersFunction({
      acao: 'create',
      email: payload.email.trim().toLowerCase(),
      nome: payload.displayName.trim(),
      displayName: payload.displayName.trim(),
      status: payload.isActive ?? true,
      isActive: payload.isActive ?? true,
      passwordRedirectTo: payload.passwordRedirectTo ?? this.getPasswordResetRedirectUrl(),
    }).pipe(
      map((response) => this.extractUser(response.data?.publicUser, payload, {
        userSetupEmailSent:
          response.data?.userSetupEmailSent === true ||
          response.data?.userDefinitionEmailSent === true,
      })),
      tap(() => {
        this.usersCache$ = undefined;
      }),
    );
  }

  updateUser(userId: number, payload: UserUpsertPayload): Observable<UserListItem> {
    return this.invokeManageUsersFunction({
      acao: 'edit',
      id: userId,
      userId,
      email: payload.email.trim().toLowerCase(),
      nome: payload.displayName.trim(),
      displayName: payload.displayName.trim(),
      status: payload.isActive ?? true,
      isActive: payload.isActive ?? true,
      emailChangeRedirectTo: payload.emailChangeRedirectTo ?? this.getEmailChangeRedirectUrl(),
    }).pipe(
      map((response) => this.extractUser(response.data?.publicUser, payload, {
        emailChangeValidationSent: response.data?.userEmailChangeValidationSent === true,
        pendingEmail: response.data?.pendingEmail ?? null,
      })),
      tap(() => {
        this.usersCache$ = undefined;
      }),
    );
  }

  deleteUser(userId: number): Observable<void> {
    return this.invokeManageUsersFunction({ acao: 'delete', id: userId, userId }).pipe(
      tap(() => {
        this.usersCache$ = undefined;
      }),
      map(() => void 0),
    );
  }

  private invokeManageUsersFunction(
    requestBody: ManageUserFunctionPayload,
  ): Observable<ManageUserFunctionResponse> {
    return this.http.post<ManageUserFunctionResponse>(
      this.MANAGE_USERS_FUNCTION_URL,
      requestBody,
      { headers: this.getAuthHeaders().set('Content-Type', 'application/json') },
    );
  }

  private getAuthHeaders(): HttpHeaders {
    const accessToken = this.loginService.requireAccessToken();

    return new HttpHeaders({
      apikey: this.ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    });
  }

  private getPasswordResetRedirectUrl(): string {
    if (typeof window === 'undefined' || !window.location?.origin) {
      return 'https://admin.washingtonlopes.com/redefinir-senha';
    }

    return `${window.location.origin}/redefinir-senha`;
  }

  private getEmailChangeRedirectUrl(): string {
    if (typeof window === 'undefined' || !window.location?.origin) {
      return 'https://admin.washingtonlopes.com/validar-email';
    }

    return `${window.location.origin}/validar-email`;
  }

  private mapUser(row: UserLookupRow | undefined): UserListItem | null {
    if (!row) {
      return null;
    }

    const userId = this.parseNumber(row.id);
    if (userId === null) {
      return null;
    }

    const email = this.parseText(row.email, 'sem-email@indisponivel');
    const displayName =
      this.parseText(row.name) ||
      this.parseText(row.display_name) ||
      this.parseText(row.full_name) ||
      this.formatDisplayName(email);

    return {
      id: userId,
      email,
      displayName: displayName || 'Usuario sem nome',
      isActive: this.inferIsActive(row),
    };
  }

  private filterRootUserForCurrentSession(users: UserListItem[]): UserListItem[] {
    const currentEmail = this.normalizeEmail(this.loginService.getCurrentUserEmail());
    const currentUser = currentEmail
      ? users.find((user) => this.normalizeEmail(user.email) === currentEmail)
      : null;

    if (currentUser?.id === this.ROOT_USER_ID) {
      return users;
    }

    return users.filter((user) => user.id !== this.ROOT_USER_ID);
  }

  private extractUser(
    row: UserLookupRow | null | undefined,
    payload: UserUpsertPayload,
    options: {
      pendingEmail?: string | null;
      emailChangeValidationSent?: boolean;
      userSetupEmailSent?: boolean;
    } = {},
  ): UserListItem {
    const user = this.mapUser(row ?? undefined);

    if (!user) {
      throw new Error('A API nao retornou o usuario salvo.');
    }

    const requestedEmail = payload.email.trim().toLowerCase();
    const requestedName = payload.displayName.trim();
    const pendingEmail = this.normalizeEmail(options.pendingEmail);
    const emailWasIgnored = user.email.trim().toLowerCase() !== requestedEmail && pendingEmail !== requestedEmail;
    const nameWasIgnored = requestedName.length > 0 && user.displayName.trim() !== requestedName;
    const statusWasIgnored = payload.isActive !== null && user.isActive !== payload.isActive;

    if (emailWasIgnored || nameWasIgnored || statusWasIgnored) {
      throw new Error('O Supabase aceitou a requisicao, mas devolveu o usuario sem as alteracoes.');
    }

    return {
      ...user,
      pendingEmail,
      emailChangeValidationSent: options.emailChangeValidationSent === true,
      userSetupEmailSent: options.userSetupEmailSent === true,
    };
  }

  private inferIsActive(row: UserLookupRow): boolean | null {
    if (typeof row.status === 'boolean') {
      return row.status;
    }

    if (typeof row.is_active === 'boolean') {
      return row.is_active;
    }

    if (typeof row.active === 'boolean') {
      return row.active;
    }

    if (typeof row.status === 'number' && !Number.isNaN(row.status)) {
      return row.status > 0;
    }

    if (typeof row.status === 'string') {
      const normalized = row.status.trim().toLowerCase();

      if (['active', 'ativo', 'enabled', 'habilitado'].includes(normalized)) {
        return true;
      }

      if (['inactive', 'inativo', 'disabled', 'desabilitado'].includes(normalized)) {
        return false;
      }
    }

    return null;
  }

  private parseNumber(value: unknown): number | null {
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
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
  }

  private parseText(value: unknown, fallback = ''): string {
    if (typeof value !== 'string') {
      return fallback;
    }

    const normalized = value.trim();
    return normalized || fallback;
  }

  private formatDisplayName(email: string): string {
    const localPart = email.split('@')[0]?.trim();
    if (!localPart) {
      return 'Usuario sem nome';
    }

    return localPart
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter((token) => token.length > 0)
      .map((token) => token[0].toUpperCase() + token.slice(1))
      .join(' ');
  }
}
