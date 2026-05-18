import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, map, shareReplay, tap } from 'rxjs';

import { LoginService } from './login.service';

export type EmailProvider = 'disabled' | 'gmail' | 'microsoft' | 'smtp' | 'resend';
export type SmtpSecurity = 'none' | 'ssl' | 'starttls';

export interface SiteSettings {
  articlesEnabled: boolean;
  contactPhoneWhatsapp: string;
  contactEmail: string;
  instagramUrl: string;
  linkedinUrl: string;
  passwordRecoverySenderEmail: string;
  userValidationSenderEmail: string;
  emailChangeSenderEmail: string;
  contactFormSenderEmail: string;
  contactConfirmationSenderEmail: string;
  contactNotificationSenderEmail: string;
  contactNotificationRecipients: string[];
  contactNotificationCcRecipients: string[];
  emailProvider: EmailProvider;
  emailFromName: string;
  emailFromAddress: string;
  emailReplyToEmail: string;
  emailSmtpHost: string;
  emailSmtpPort: number;
  emailSmtpSecurity: SmtpSecurity;
  emailSmtpUsername: string;
  emailSmtpPasswordConfigured: boolean;
  emailLastTestAt: string | null;
  emailLastTestStatus: string;
  emailLastTestError: string;
  updatedAt: string | null;
  updatedBy: number | null;
}

export interface SiteSettingsPayload {
  emailAction?: 'test';
  articlesEnabled?: boolean;
  contactPhoneWhatsapp?: string;
  contactEmail?: string;
  instagramUrl?: string;
  linkedinUrl?: string;
  passwordRecoverySenderEmail?: string;
  userValidationSenderEmail?: string;
  emailChangeSenderEmail?: string;
  contactFormSenderEmail?: string;
  contactConfirmationSenderEmail?: string;
  contactNotificationSenderEmail?: string;
  contactNotificationRecipients?: string[];
  contactNotificationCcRecipients?: string[];
  emailProvider?: EmailProvider;
  emailFromName?: string;
  emailFromAddress?: string;
  emailReplyToEmail?: string;
  emailSmtpHost?: string;
  emailSmtpPort?: number;
  emailSmtpSecurity?: SmtpSecurity;
  emailSmtpUsername?: string;
  emailSmtpPassword?: string;
  emailTestRecipient?: string;
}

interface SettingsFunctionResponse {
  data?: Partial<SiteSettings> | null;
  emailTest?: {
    sent?: boolean;
    error?: string | null;
  } | null;
  mensagem?: string;
  error?: string;
  erro?: string;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private readonly SUPABASE_URL = 'https://wwwntzwmvjvivputmlqg.supabase.co';
  private readonly SETTINGS_FUNCTION_URL = `${this.SUPABASE_URL}/functions/v1/configuracoes-site`;
  private readonly ANON_KEY = 'sb_publishable_EREcwSKRXkRIRknqHOMh0g_FyIU7He0';

  private settingsCache$?: Observable<SiteSettings>;
  private readonly settingsStateSubject = new BehaviorSubject<SiteSettings | null>(null);

  readonly settingsChanges$ = this.settingsStateSubject.asObservable();

  constructor(
    private readonly http: HttpClient,
    private readonly loginService: LoginService,
  ) {}

  getSettings(forceRefresh = false): Observable<SiteSettings> {
    if (forceRefresh) {
      this.settingsCache$ = undefined;
    }

    if (this.settingsCache$) {
      return this.settingsCache$;
    }

    this.settingsCache$ = this.http
      .get<SettingsFunctionResponse>(this.SETTINGS_FUNCTION_URL, { headers: this.getAuthHeaders() })
      .pipe(
        map((response) => this.mapSettings(response.data)),
        tap((settings) => {
          this.settingsStateSubject.next(settings);
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );

    return this.settingsCache$;
  }

  saveSettings(payload: SiteSettingsPayload): Observable<SiteSettings> {
    return this.http
      .post<SettingsFunctionResponse>(this.SETTINGS_FUNCTION_URL, payload, {
        headers: this.getAuthHeaders().set('Content-Type', 'application/json'),
      })
      .pipe(
        map((response) => this.mapSettings(response.data)),
        tap((settings) => {
          this.settingsStateSubject.next(settings);
          this.settingsCache$ = undefined;
          this.settingsCache$ = new Observable<SiteSettings>((subscriber) => {
            subscriber.next(settings);
            subscriber.complete();
          }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
        }),
      );
  }

  testEmailSettings(payload: SiteSettingsPayload): Observable<{
    settings: SiteSettings;
    sent: boolean;
    error: string | null;
  }> {
    return this.http
      .post<SettingsFunctionResponse>(
        this.SETTINGS_FUNCTION_URL,
        { ...payload, emailAction: 'test' },
        { headers: this.getAuthHeaders().set('Content-Type', 'application/json') },
      )
      .pipe(
        map((response) => ({
          settings: this.mapSettings(response.data),
          sent: response.emailTest?.sent === true,
          error: this.parseNullableText(response.emailTest?.error),
        })),
        tap(({ settings }) => {
          this.settingsStateSubject.next(settings);
          this.settingsCache$ = undefined;
          this.settingsCache$ = new Observable<SiteSettings>((subscriber) => {
            subscriber.next(settings);
            subscriber.complete();
          }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
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

  private mapSettings(raw: Partial<SiteSettings> | null | undefined): SiteSettings {
    return {
      articlesEnabled: raw?.articlesEnabled !== false,
      contactPhoneWhatsapp: this.parseText(raw?.contactPhoneWhatsapp),
      contactEmail: this.parseText(raw?.contactEmail),
      instagramUrl: this.parseText(raw?.instagramUrl),
      linkedinUrl: this.parseText(raw?.linkedinUrl),
      passwordRecoverySenderEmail: this.parseText(raw?.passwordRecoverySenderEmail, 'washingtonlopes2003@gmail.com'),
      userValidationSenderEmail: this.parseText(raw?.userValidationSenderEmail, 'washingtonlopes2003@gmail.com'),
      emailChangeSenderEmail: this.parseText(raw?.emailChangeSenderEmail, 'washingtonlopes2003@gmail.com'),
      contactFormSenderEmail: this.parseText(
        raw?.contactFormSenderEmail || raw?.contactNotificationSenderEmail || raw?.contactConfirmationSenderEmail,
        'washingtonlopes2003@gmail.com',
      ),
      contactConfirmationSenderEmail: this.parseText(
        raw?.contactConfirmationSenderEmail || raw?.contactFormSenderEmail,
        'washingtonlopes2003@gmail.com',
      ),
      contactNotificationSenderEmail: this.parseText(
        raw?.contactNotificationSenderEmail || raw?.contactFormSenderEmail,
        'washingtonlopes2003@gmail.com',
      ),
      contactNotificationRecipients: Array.isArray(raw?.contactNotificationRecipients)
        ? raw.contactNotificationRecipients.filter((email): email is string => typeof email === 'string')
        : ['washingtonlopes2003@gmail.com'],
      contactNotificationCcRecipients: Array.isArray(raw?.contactNotificationCcRecipients)
        ? raw.contactNotificationCcRecipients.filter((email): email is string => typeof email === 'string')
        : [],
      emailProvider: this.parseEmailProvider(raw?.emailProvider),
      emailFromName: this.parseText(raw?.emailFromName, 'Kevin Willian Advogado'),
      emailFromAddress: this.parseText(raw?.emailFromAddress, 'washingtonlopes2003@gmail.com'),
      emailReplyToEmail: this.parseText(raw?.emailReplyToEmail),
      emailSmtpHost: this.parseText(raw?.emailSmtpHost),
      emailSmtpPort: this.parsePort(raw?.emailSmtpPort),
      emailSmtpSecurity: this.parseSmtpSecurity(raw?.emailSmtpSecurity),
      emailSmtpUsername: this.parseText(raw?.emailSmtpUsername),
      emailSmtpPasswordConfigured: raw?.emailSmtpPasswordConfigured === true,
      emailLastTestAt: this.parseNullableText(raw?.emailLastTestAt),
      emailLastTestStatus: this.parseText(raw?.emailLastTestStatus),
      emailLastTestError: this.parseText(raw?.emailLastTestError),
      updatedAt: this.parseNullableText(raw?.updatedAt),
      updatedBy: typeof raw?.updatedBy === 'number' ? raw.updatedBy : null,
    };
  }

  private parseEmailProvider(value: unknown): EmailProvider {
    return value === 'gmail' || value === 'microsoft' || value === 'smtp' || value === 'resend'
      ? value
      : 'disabled';
  }

  private parseSmtpSecurity(value: unknown): SmtpSecurity {
    return value === 'ssl' || value === 'none' ? value : 'starttls';
  }

  private parsePort(value: unknown): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 587;
  }

  private parseText(value: unknown, fallback = ''): string {
    if (typeof value !== 'string') {
      return fallback;
    }

    const normalized = value.trim();
    return normalized || fallback;
  }

  private parseNullableText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized || null;
  }
}
