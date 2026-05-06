import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, map, Observable, of, shareReplay, switchMap, tap, throwError } from 'rxjs';

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

type DisplayNameField = 'display_name' | 'full_name' | 'name' | null;
type ActiveField = 'is_active' | 'active' | 'status' | null;
type ActiveFieldType = 'boolean' | 'number' | 'string' | null;
type ResolvedActiveFieldType = Exclude<ActiveFieldType, null>;

export interface UserListItem {
  id: number;
  email: string;
  displayName: string;
  isActive: boolean | null;
}

export interface UserUpsertPayload {
  email: string;
  displayName: string;
  isActive: boolean | null;
  password?: string | null;
}

type ManageUserAction = 'create' | 'edit' | 'delete';

interface ManageUserFunctionPayload {
  acao: ManageUserAction;
  id?: string;
  authUserId?: string;
  actorId?: number;
  createdBy?: number;
  updatedBy?: number;
  email?: string;
  currentEmail?: string;
  previousEmail?: string;
  password?: string;
  nome?: string;
  displayName?: string;
  status?: boolean;
  isActive?: boolean;
}

interface ManageUserFunctionResponse {
  mensagem?: string;
  data?: {
    authUser?: {
      id?: string | null;
      email?: string | null;
    } | null;
    publicUser?: UserLookupRow | null;
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
  private readonly USERS_URL = `${this.SUPABASE_URL}/rest/v1/users`;
  private readonly MANAGE_USERS_FUNCTION_URL = `${this.SUPABASE_URL}/functions/v1/gerenciar-usuarios`;
  private readonly ANON_KEY = 'sb_publishable_EREcwSKRXkRIRknqHOMh0g_FyIU7He0';
  private readonly FALLBACK_ACTOR_ID = 10447;

  private usersCache$?: Observable<UserListItem[]>;
  private displayNameField: DisplayNameField | undefined = undefined;
  private activeField: ActiveField | undefined = undefined;
  private activeFieldType: ActiveFieldType = null;

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

    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', '*')
      .set('order', 'id.asc');

    this.usersCache$ = this.http.get<UserLookupRow[]>(this.USERS_URL, { headers, params }).pipe(
      map((rows) =>
        (Array.isArray(rows) ? rows : [])
          .map((row) => this.mapUser(row))
          .filter((user): user is UserListItem => user !== null),
      ),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    return this.usersCache$;
  }

  getUserById(userId: number): Observable<UserListItem | null> {
    const normalizedUserId = this.parseNumber(userId);
    if (normalizedUserId === null || normalizedUserId <= 0) {
      return of(null);
    }

    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', '*')
      .set('id', `eq.${normalizedUserId}`)
      .set('limit', '1');

    return this.http.get<UserLookupRow[]>(this.USERS_URL, { headers, params }).pipe(
      map((rows) => {
        const [row] = Array.isArray(rows) ? rows : [];
        return this.mapUser(row);
      }),
    );
  }

  createUser(payload: UserUpsertPayload): Observable<UserListItem> {
    const password = payload.password?.trim();
    if (!password || password.length < 6) {
      return throwError(() => new Error('Informe uma senha com pelo menos 6 caracteres.'));
    }

    return this.getCurrentActorId().pipe(
      switchMap((actorId) => this.createAuthUser(payload, password, actorId)),
      switchMap((response) => this.extractCreatedUserFromFunction(response, payload)),
      tap(() => {
        this.usersCache$ = undefined;
      }),
    );
  }

  updateUser(userId: number, payload: UserUpsertPayload): Observable<UserListItem> {
    return this.getCurrentActorId().pipe(
      switchMap((actorId) =>
        this.getRawUserById(userId).pipe(
          switchMap((row) => {
            if (!row) {
              return throwError(() => new Error('Usuario nao encontrado.'));
            }

            this.syncFieldCapabilities(row);

            return this.updateAuthUser(payload, row).pipe(
              switchMap(() =>
                this.patchUser(userId, this.mapUserPayload(payload, actorId)).pipe(
                  catchError((error: unknown) =>
                    this.retryPatchUserWithAlternateStatusFormats(error, userId, payload, actorId),
                  ),
                ),
              ),
              switchMap(() => this.getRawUserById(userId)),
              map((row) => this.extractUpdatedUser(row ? [row] : [], payload)),
            );
          }),
        ),
      ),
      tap(() => {
        this.usersCache$ = undefined;
      }),
    );
  }

  deleteUser(userId: number): Observable<void> {
    return this.getRawUserById(userId).pipe(
      switchMap((row) =>
        this.deleteAuthUser(row).pipe(
          switchMap(() => this.deletePublicUser(userId)),
        ),
      ),
      tap(() => {
        this.usersCache$ = undefined;
      }),
    );
  }

  private deletePublicUser(userId: number): Observable<void> {
    const headers = this.getAuthHeaders().set('Prefer', 'return=minimal');
    const params = new HttpParams().set('id', `eq.${userId}`);

    return this.http.delete<null>(this.USERS_URL, { headers, params }).pipe(
      map(() => void 0),
    );
  }

  private getAuthHeaders(): HttpHeaders {
    const accessToken = this.loginService.requireAccessToken();

    return new HttpHeaders({
      apikey: this.ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    });
  }

  private mapUser(row: UserLookupRow | undefined): UserListItem | null {
    if (!row) {
      return null;
    }

    this.syncFieldCapabilities(row);

    const userId = this.parseNumber(row.id);
    if (userId === null) {
      return null;
    }

    const email = this.parseText(row.email, 'sem-email@indisponivel');
    const displayName =
      this.parseText(this.readDisplayNameValue(row)) ||
      this.formatDisplayName(email);

    return {
      id: userId,
      email,
      displayName: displayName || 'Usuario sem nome',
      isActive: this.inferIsActive(row),
    };
  }

  private syncFieldCapabilities(row: UserLookupRow): void {
    const displayNameField = this.resolveDisplayNameField(row);
    if (displayNameField !== null || this.displayNameField === undefined) {
      this.displayNameField = displayNameField;
    }

    const activeField = this.resolveActiveField(row);
    if (activeField !== null || this.activeField === undefined) {
      this.activeField = activeField;
    }

    if (activeField === 'is_active' || activeField === 'active') {
      this.activeFieldType = 'boolean';
      return;
    }

    if (activeField === 'status') {
      this.activeField = 'status';
      this.activeFieldType = this.detectActiveFieldType(row.status) ?? this.activeFieldType;
    }
  }

  private resolveDisplayNameField(row: UserLookupRow): DisplayNameField {
    if (Object.prototype.hasOwnProperty.call(row, 'name')) {
      return 'name';
    }

    if (Object.prototype.hasOwnProperty.call(row, 'display_name')) {
      return 'display_name';
    }

    if (Object.prototype.hasOwnProperty.call(row, 'full_name')) {
      return 'full_name';
    }

    return null;
  }

  private resolveActiveField(row: UserLookupRow): ActiveField {
    if (Object.prototype.hasOwnProperty.call(row, 'status')) {
      return 'status';
    }

    if (Object.prototype.hasOwnProperty.call(row, 'is_active')) {
      return 'is_active';
    }

    if (Object.prototype.hasOwnProperty.call(row, 'active')) {
      return 'active';
    }

    return null;
  }

  private readDisplayNameValue(row: UserLookupRow): string | null {
    if (this.displayNameField === 'display_name') {
      return this.parseText(row.display_name) || null;
    }

    if (this.displayNameField === 'full_name') {
      return this.parseText(row.full_name) || null;
    }

    if (this.displayNameField === 'name') {
      return this.parseText(row.name) || null;
    }

    return null;
  }

  private inferIsActive(row: UserLookupRow): boolean | null {
    if (this.activeField === 'is_active') {
      return this.parseBoolean(row.is_active);
    }

    if (this.activeField === 'active') {
      return this.parseBoolean(row.active);
    }

    if (this.activeField === 'status') {
      if (this.activeFieldType === 'boolean') {
        return this.parseBoolean(row.status);
      }

      if (this.activeFieldType === 'number') {
        if (typeof row.status !== 'number' || Number.isNaN(row.status)) {
          return null;
        }

        return row.status > 0;
      }

      if (this.activeFieldType === 'string') {
        if (typeof row.status !== 'string') {
          return null;
        }

        const normalized = row.status.trim().toLowerCase();
        if (!normalized) {
          return null;
        }

        if (['active', 'ativo', 'enabled', 'habilitado'].includes(normalized)) {
          return true;
        }

        if (['inactive', 'inativo', 'disabled', 'desabilitado'].includes(normalized)) {
          return false;
        }
      }
    }

    return null;
  }

  private createAuthUser(
    payload: UserUpsertPayload,
    password: string,
    actorId: number,
  ): Observable<ManageUserFunctionResponse> {
    return this.invokeManageUsersFunction({
      acao: 'create',
      actorId,
      createdBy: actorId,
      updatedBy: actorId,
      email: payload.email.trim().toLowerCase(),
      password,
      nome: payload.displayName.trim(),
      displayName: payload.displayName.trim(),
      status: payload.isActive ?? true,
      isActive: payload.isActive ?? true,
    });
  }

  private updateAuthUser(payload: UserUpsertPayload, row: UserLookupRow): Observable<unknown> {
    return this.invokeManageUsersFunction({
      ...this.mapAuthUserIdentifiers(row),
      acao: 'edit',
      email: payload.email.trim().toLowerCase(),
      password: payload.password?.trim() || undefined,
      nome: payload.displayName.trim(),
      displayName: payload.displayName.trim(),
    });
  }

  private deleteAuthUser(row: UserLookupRow | null): Observable<unknown> {
    return this.invokeManageUsersFunction({
      ...this.mapAuthUserIdentifiers(row),
      acao: 'delete',
    });
  }

  private invokeManageUsersFunction(
    requestBody: ManageUserFunctionPayload,
  ): Observable<ManageUserFunctionResponse> {
    const headers = this.getAuthHeaders().set('Content-Type', 'application/json');

    return this.http.post<ManageUserFunctionResponse>(
      this.MANAGE_USERS_FUNCTION_URL,
      requestBody,
      { headers },
    );
  }

  private mapAuthUserIdentifiers(row: UserLookupRow | null): Partial<ManageUserFunctionPayload> {
    if (!row) {
      return {};
    }

    const authUserId = this.parseText(row.auth_user_id) || this.parseText(row.auth_id);
    const currentEmail = this.parseText(row.email);
    const identifiers: Partial<ManageUserFunctionPayload> = {};

    if (authUserId) {
      identifiers.authUserId = authUserId;
      identifiers.id = authUserId;
    }

    if (currentEmail) {
      identifiers.currentEmail = currentEmail.trim().toLowerCase();
      identifiers.previousEmail = currentEmail.trim().toLowerCase();
    }

    return identifiers;
  }

  private extractCreatedUserFromFunction(
    response: ManageUserFunctionResponse,
    payload: UserUpsertPayload,
  ): Observable<UserListItem> {
    const userFromResponse = this.mapUser(response.data?.publicUser ?? undefined);

    if (userFromResponse) {
      return of(userFromResponse);
    }

    return this.getRawUserByEmail(payload.email).pipe(
      map((row) => this.extractUser(row ? [row] : [])),
    );
  }

  private mapUserPayload(
    payload: UserUpsertPayload,
    actorId: number,
    activeFieldTypeOverride: ActiveFieldType = null,
  ): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
      email: payload.email.trim().toLowerCase(),
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    };

    const displayNameField = this.displayNameField === undefined ? null : this.displayNameField;
    const normalizedDisplayName = payload.displayName.trim();
    if (normalizedDisplayName && displayNameField) {
      requestBody[displayNameField] = normalizedDisplayName;
    }

    const activeField = this.activeField === undefined ? null : this.activeField;
    if (payload.isActive !== null && activeField) {
      const activeFieldType = activeFieldTypeOverride ?? this.activeFieldType ?? 'boolean';
      requestBody[activeField] = this.formatActiveFieldValue(payload.isActive, activeFieldType);
    }

    return requestBody;
  }

  private patchUser(userId: number, requestBody: Record<string, unknown>): Observable<null> {
    const headers = this.getAuthHeaders()
      .set('Content-Type', 'application/json')
      .set('Prefer', 'return=minimal');
    const params = new HttpParams().set('id', `eq.${userId}`);

    return this.http.patch<null>(
      this.USERS_URL,
      requestBody,
      { headers, params },
    );
  }

  private retryPatchUserWithAlternateStatusFormats(
    error: unknown,
    userId: number,
    payload: UserUpsertPayload,
    actorId: number,
  ): Observable<null> {
    if (payload.isActive === null || !this.activeField || !this.shouldRetryStatusPayload(error)) {
      return throwError(() => error);
    }

    const attemptedType = this.activeFieldType ?? 'boolean';
    const fallbackTypes: ResolvedActiveFieldType[] = ['number', 'string', 'boolean']
      .filter((type): type is ResolvedActiveFieldType => type !== attemptedType);

    return this.patchUserWithStatusTypeAttempts(userId, payload, actorId, fallbackTypes, error);
  }

  private patchUserWithStatusTypeAttempts(
    userId: number,
    payload: UserUpsertPayload,
    actorId: number,
    activeFieldTypes: ResolvedActiveFieldType[],
    lastError: unknown,
  ): Observable<null> {
    const [activeFieldType, ...remainingTypes] = activeFieldTypes;
    if (!activeFieldType) {
      return throwError(() => lastError);
    }

    return this.patchUser(userId, this.mapUserPayload(payload, actorId, activeFieldType)).pipe(
      tap(() => {
        this.activeFieldType = activeFieldType;
      }),
      catchError((error: unknown) =>
        this.patchUserWithStatusTypeAttempts(userId, payload, actorId, remainingTypes, error),
      ),
    );
  }

  private getRawUserById(userId: number): Observable<UserLookupRow | null> {
    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', '*')
      .set('id', `eq.${userId}`)
      .set('limit', '1');

    return this.http.get<UserLookupRow[]>(this.USERS_URL, { headers, params }).pipe(
      map((rows) => {
        const [row] = Array.isArray(rows) ? rows : [];
        return row ?? null;
      }),
    );
  }

  private getRawUserByEmail(email: string): Observable<UserLookupRow | null> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return of(null);
    }

    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', '*')
      .set('email', `eq.${normalizedEmail}`)
      .set('limit', '1');

    return this.http.get<UserLookupRow[]>(this.USERS_URL, { headers, params }).pipe(
      map((rows) => {
        const [row] = Array.isArray(rows) ? rows : [];
        return row ?? null;
      }),
    );
  }

  private getCurrentActorId(): Observable<number> {
    const currentEmail = this.loginService.getCurrentUserEmail();
    if (!currentEmail) {
      return of(this.FALLBACK_ACTOR_ID);
    }

    const headers = this.getAuthHeaders();
    const params = new HttpParams()
      .set('select', 'id,email')
      .set('email', `eq.${currentEmail}`)
      .set('limit', '1');

    return this.http.get<UserLookupRow[]>(this.USERS_URL, { headers, params }).pipe(
      map((rows) => {
        const [row] = Array.isArray(rows) ? rows : [];
        return this.parseNumber(row?.id) ?? this.FALLBACK_ACTOR_ID;
      }),
      catchError(() => of(this.FALLBACK_ACTOR_ID)),
    );
  }

  private extractUser(rows: UserLookupRow[] | null | undefined): UserListItem {
    const [row] = Array.isArray(rows) ? rows : [];
    const user = this.mapUser(row);

    if (!user) {
      throw new Error('A API nao retornou o usuario salvo.');
    }

    return user;
  }

  private extractUpdatedUser(rows: UserLookupRow[] | null | undefined, payload: UserUpsertPayload): UserListItem {
    const [row] = Array.isArray(rows) ? rows : [];
    const user = this.mapUser(row);

    if (!user) {
      throw new Error('A tabela users nao confirmou a atualizacao. Verifique se existe policy UPDATE para usuarios autenticados.');
    }

    const requestedEmail = payload.email.trim().toLowerCase();
    const requestedName = payload.displayName.trim();
    const canPersistName = this.displayNameField !== undefined && this.displayNameField !== null;
    const canPersistStatus = this.activeField !== undefined && this.activeField !== null;
    const emailWasIgnored = user.email.trim().toLowerCase() !== requestedEmail;
    const nameWasIgnored = canPersistName && requestedName.length > 0 && user.displayName.trim() !== requestedName;
    const statusWasIgnored = canPersistStatus && payload.isActive !== null && user.isActive !== payload.isActive;

    if (emailWasIgnored || nameWasIgnored || statusWasIgnored) {
      throw new Error('O Supabase aceitou a requisicao, mas devolveu o usuario sem as alteracoes. Revise as colunas e policies de UPDATE da tabela users.');
    }

    return user;
  }

  private detectActiveFieldType(value: unknown): ActiveFieldType {
    if (typeof value === 'boolean') {
      return 'boolean';
    }

    if (typeof value === 'number' && !Number.isNaN(value)) {
      return 'number';
    }

    if (typeof value === 'string') {
      return 'string';
    }

    return null;
  }

  private formatActiveFieldValue(isActive: boolean, activeFieldType: ResolvedActiveFieldType): boolean | number | string {
    if (activeFieldType === 'number') {
      return isActive ? 1 : 0;
    }

    if (activeFieldType === 'string') {
      return isActive ? 'active' : 'inactive';
    }

    return isActive;
  }

  private shouldRetryStatusPayload(error: unknown): boolean {
    const status = this.extractHttpStatus(error);
    if (status !== null && status !== 400) {
      return false;
    }

    const message = this.extractErrorMessage(error).toLowerCase();
    return !message ||
      message.includes('status') ||
      message.includes('invalid input syntax') ||
      message.includes('invalid_text_representation') ||
      message.includes('invalid input value');
  }

  private extractHttpStatus(error: unknown): number | null {
    if (!error || typeof error !== 'object') {
      return null;
    }

    const status = (error as Record<string, unknown>)['status'];
    return typeof status === 'number' ? status : null;
  }

  private isExistingAuthUserError(error: unknown): boolean {
    const message = this.extractErrorMessage(error).toLowerCase();

    return message.includes('already') ||
      message.includes('registered') ||
      message.includes('exists') ||
      message.includes('ja cadastrado') ||
      message.includes('já cadastrado');
  }

  private extractErrorMessage(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return '';
    }

    const record = error as Record<string, unknown>;
    const errorBody = record['error'];

    if (errorBody && typeof errorBody === 'object') {
      const bodyRecord = errorBody as Record<string, unknown>;
      return [
        bodyRecord['message'],
        bodyRecord['msg'],
        bodyRecord['error_description'],
        bodyRecord['error'],
        bodyRecord['erro'],
      ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    }

    return [
      record['message'],
      record['error_description'],
      record['error'],
      record['erro'],
    ]
      .filter((value): value is string => typeof value === 'string')
      .join(' ');
  }

  private parseNumber(value: unknown): number | null {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return null;
    }

    return value;
  }

  private parseBoolean(value: unknown): boolean | null {
    if (typeof value !== 'boolean') {
      return null;
    }

    return value;
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
