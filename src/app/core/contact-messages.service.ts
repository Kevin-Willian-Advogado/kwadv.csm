import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map, shareReplay, tap } from 'rxjs';

import { LoginService } from './login.service';

export type ContactMessageStatus = 'unread' | 'read' | 'archived';

export interface ContactMessage {
  id: number;
  name: string;
  email: string;
  phone: string;
  message: string;
  status: ContactMessageStatus;
  emailConfirmationSent: boolean;
  emailNotificationSent: boolean;
  emailDeliveryError: string | null;
  confirmationSenderEmail: string;
  confirmationRecipientEmail: string;
  notificationSenderEmail: string;
  notificationRecipientEmails: string[];
  notificationCcEmails: string[];
  createdAt: string | null;
  readAt: string | null;
}

interface ContactMessagesFunctionResponse {
  data?: {
    messages?: Partial<ContactMessage>[] | null;
    message?: Partial<ContactMessage> | null;
  } | null;
  mensagem?: string;
  error?: string;
  erro?: string;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ContactMessagesService {
  private readonly SUPABASE_URL = 'https://wwwntzwmvjvivputmlqg.supabase.co';
  private readonly CONTACT_MESSAGES_FUNCTION_URL = `${this.SUPABASE_URL}/functions/v1/mensagens-contato`;
  private readonly ANON_KEY = 'sb_publishable_EREcwSKRXkRIRknqHOMh0g_FyIU7He0';

  private messagesCache$?: Observable<ContactMessage[]>;

  constructor(
    private readonly http: HttpClient,
    private readonly loginService: LoginService,
  ) {}

  getMessages(forceRefresh = false): Observable<ContactMessage[]> {
    if (forceRefresh) {
      this.messagesCache$ = undefined;
    }

    if (this.messagesCache$) {
      return this.messagesCache$;
    }

    this.messagesCache$ = this.http
      .get<ContactMessagesFunctionResponse>(this.CONTACT_MESSAGES_FUNCTION_URL, { headers: this.getAuthHeaders() })
      .pipe(
        map((response) => this.extractMessages(response)),
        shareReplay({ bufferSize: 1, refCount: true }),
      );

    return this.messagesCache$;
  }

  updateStatus(messageId: number, status: ContactMessageStatus): Observable<ContactMessage> {
    return this.http
      .patch<ContactMessagesFunctionResponse>(
        this.CONTACT_MESSAGES_FUNCTION_URL,
        { id: messageId, status },
        { headers: this.getAuthHeaders().set('Content-Type', 'application/json') },
      )
      .pipe(
        map((response) => this.mapMessage(this.extractUpdatedMessage(response))),
        tap(() => {
          this.messagesCache$ = undefined;
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

  private extractMessages(response: ContactMessagesFunctionResponse): ContactMessage[] {
    const data = response.data;
    if (!data || !('messages' in data) || !Array.isArray(data.messages)) {
      return [];
    }

    return data.messages
      .map((message) => this.mapMessage(message))
      .filter((message): message is ContactMessage => message.id > 0);
  }

  private extractUpdatedMessage(response: ContactMessagesFunctionResponse): Partial<ContactMessage> | null | undefined {
    const data = response.data;
    if (!data) {
      return null;
    }

    if ('message' in data) {
      return data.message;
    }

    return null;
  }

  private mapMessage(raw: Partial<ContactMessage> | null | undefined): ContactMessage {
    return {
      id: typeof raw?.id === 'number' ? raw.id : 0,
      name: this.parseText(raw?.name, 'Contato sem nome'),
      email: this.parseText(raw?.email),
      phone: this.parseText(raw?.phone),
      message: this.parseText(raw?.message),
      status: this.parseStatus(raw?.status),
      emailConfirmationSent: raw?.emailConfirmationSent === true,
      emailNotificationSent: raw?.emailNotificationSent === true,
      emailDeliveryError: this.parseNullableText(raw?.emailDeliveryError),
      confirmationSenderEmail: this.parseText(raw?.confirmationSenderEmail),
      confirmationRecipientEmail: this.parseText(raw?.confirmationRecipientEmail),
      notificationSenderEmail: this.parseText(raw?.notificationSenderEmail),
      notificationRecipientEmails: Array.isArray(raw?.notificationRecipientEmails)
        ? raw.notificationRecipientEmails.filter((email): email is string => typeof email === 'string')
        : [],
      notificationCcEmails: Array.isArray(raw?.notificationCcEmails)
        ? raw.notificationCcEmails.filter((email): email is string => typeof email === 'string')
        : [],
      createdAt: this.parseNullableText(raw?.createdAt),
      readAt: this.parseNullableText(raw?.readAt),
    };
  }

  private parseStatus(value: unknown): ContactMessageStatus {
    if (value === 'read' || value === 'archived') {
      return value;
    }

    return 'unread';
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
