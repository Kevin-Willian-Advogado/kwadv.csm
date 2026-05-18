import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, finalize, timer } from 'rxjs';

import {
  ContactMessage,
  ContactMessageStatus,
  ContactMessagesService,
} from '../../core/contact-messages.service';

@Component({
  selector: 'app-messages',
  imports: [CommonModule, FormsModule],
  templateUrl: './messages.html',
  styleUrl: './messages.css',
})
export class Messages implements OnInit, OnDestroy {
  private readonly contactMessagesService = inject(ContactMessagesService);
  private readonly autoRefreshIntervalMs = 30000;
  private autoRefreshSubscription?: Subscription;
  private copiedFieldTimeoutId: ReturnType<typeof setTimeout> | null = null;

  messages: ContactMessage[] = [];
  selectedMessage: ContactMessage | null = null;
  isLoading = true;
  isRefreshing = false;
  isUpdating = false;
  errorMessage = '';
  searchTerm = '';
  filterUnread = false;
  copiedField: 'email' | 'phone' | null = null;

  ngOnInit(): void {
    this.loadMessages();
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.autoRefreshSubscription?.unsubscribe();
    if (this.copiedFieldTimeoutId !== null) {
      clearTimeout(this.copiedFieldTimeoutId);
    }
  }

  get visibleMessages(): ContactMessage[] {
    const term = this.searchTerm.trim().toLowerCase();

    return this.messages.filter((message) => {
      if (this.filterUnread && message.status !== 'unread') {
        return false;
      }

      if (!term) {
        return true;
      }

      return [
        message.name,
        message.email,
        message.phone,
        message.message,
        this.getStatusLabel(message),
        this.getEmailStatusLabel(message),
      ]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }

  selectMessage(message: ContactMessage): void {
    this.selectedMessage = message;

    if (message.status === 'unread') {
      this.updateStatus(message, 'read');
    }
  }

  setSearchTerm(value: string): void {
    this.searchTerm = value;
    this.selectedMessage = this.reselectMessage(this.visibleMessages);
  }

  toggleUnreadFilter(): void {
    this.filterUnread = !this.filterUnread;
    this.selectedMessage = this.reselectMessage(this.visibleMessages);
  }

  markAsUnread(message: ContactMessage, event?: Event): void {
    event?.stopPropagation();
    this.updateStatus(message, 'unread');
  }

  markAsRead(message: ContactMessage, event?: Event): void {
    event?.stopPropagation();
    this.updateStatus(message, 'read');
  }

  archiveMessage(message: ContactMessage, event?: Event): void {
    event?.stopPropagation();
    this.updateStatus(message, 'archived');
  }

  restoreMessage(message: ContactMessage, event?: Event): void {
    event?.stopPropagation();
    this.updateStatus(message, 'read');
  }

  refresh(): void {
    this.loadMessages(true);
  }

  async copyToClipboard(
    value: string | null | undefined,
    event?: Event,
    field: 'email' | 'phone' | null = null,
  ): Promise<void> {
    event?.stopPropagation();

    const text = value?.trim();
    if (!text) {
      return;
    }

    await navigator.clipboard.writeText(text);
    this.showCopiedFeedback(field);
  }

  getStatusClasses(message: ContactMessage): string {
    const baseClasses = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold';

    if (message.status === 'unread') {
      return `${baseClasses} bg-orange-50 text-orange-700`;
    }

    if (message.status === 'archived') {
      return `${baseClasses} bg-slate-100 text-slate-500`;
    }

    return `${baseClasses} bg-emerald-50 text-emerald-700`;
  }

  getStatusLabel(message: ContactMessage): string {
    if (message.status === 'unread') {
      return 'Nao lida';
    }

    if (message.status === 'archived') {
      return 'Arquivada';
    }

    return 'Lida';
  }

  getEmailStatusLabel(message: ContactMessage): string {
    if (message.emailConfirmationSent && message.emailNotificationSent) {
      return 'E-mails enviados';
    }

    if (this.hasEmailIssue(message)) {
      return 'Falha no envio';
    }

    return 'Envio pendente';
  }

  getEmailStatusClasses(message: ContactMessage): string {
    const baseClasses = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold';

    if (message.emailConfirmationSent && message.emailNotificationSent) {
      return `${baseClasses} bg-emerald-50 text-emerald-700`;
    }

    if (this.hasEmailIssue(message)) {
      return `${baseClasses} bg-orange-50 text-orange-700`;
    }

    return `${baseClasses} bg-slate-100 text-slate-600`;
  }

  hasEmailIssue(message: ContactMessage): boolean {
    return !!message.emailDeliveryError && (!message.emailConfirmationSent || !message.emailNotificationSent);
  }

  private startAutoRefresh(): void {
    this.autoRefreshSubscription = timer(this.autoRefreshIntervalMs, this.autoRefreshIntervalMs).subscribe(() => {
      if (this.isLoading || this.isRefreshing || this.isUpdating) {
        return;
      }

      this.loadMessages(true, false);
    });
  }

  private loadMessages(forceRefresh = false, showLoadingState = true): void {
    if (showLoadingState) {
      this.isLoading = true;
    } else {
      this.isRefreshing = true;
    }

    this.errorMessage = '';

    this.contactMessagesService
      .getMessages(forceRefresh)
      .pipe(finalize(() => {
        if (showLoadingState) {
          this.isLoading = false;
        } else {
          this.isRefreshing = false;
        }
      }))
      .subscribe({
        next: (messages) => {
          this.messages = messages;
          this.selectedMessage = this.reselectMessage(this.visibleMessages);
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel carregar as mensagens.';
          console.error('Erro ao carregar mensagens:', error);
        },
      });
  }

  private updateStatus(message: ContactMessage, status: ContactMessageStatus): void {
    if (this.isUpdating) {
      return;
    }

    this.isUpdating = true;
    this.errorMessage = '';

    this.contactMessagesService
      .updateStatus(message.id, status)
      .pipe(finalize(() => {
        this.isUpdating = false;
      }))
      .subscribe({
        next: (updatedMessage) => {
          this.messages = this.messages.map((item) =>
            item.id === updatedMessage.id ? updatedMessage : item,
          );
          this.selectedMessage = this.visibleMessages.some((message) => message.id === updatedMessage.id)
            ? updatedMessage
            : this.reselectMessage(this.visibleMessages);
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel atualizar a mensagem.';
          console.error('Erro ao atualizar mensagem:', error);
        },
      });
  }

  private reselectMessage(messages: ContactMessage[]): ContactMessage | null {
    if (messages.length === 0) {
      return null;
    }

    if (!this.selectedMessage) {
      return null;
    }

    return messages.find((message) => message.id === this.selectedMessage?.id) ?? null;
  }

  private showCopiedFeedback(field: 'email' | 'phone' | null): void {
    if (!field) {
      return;
    }

    this.copiedField = field;

    if (this.copiedFieldTimeoutId !== null) {
      clearTimeout(this.copiedFieldTimeoutId);
    }

    this.copiedFieldTimeoutId = setTimeout(() => {
      this.copiedField = null;
      this.copiedFieldTimeoutId = null;
    }, 1200);
  }
}
