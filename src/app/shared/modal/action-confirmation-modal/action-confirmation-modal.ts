import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

export type ActionConfirmationModalTone = 'primary' | 'danger';

export interface ActionConfirmationModalConfig {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  hint?: string;
  highlights?: string[];
  tone?: ActionConfirmationModalTone;
}

@Component({
  selector: 'app-action-confirmation-modal',
  imports: [CommonModule],
  templateUrl: './action-confirmation-modal.html',
})
export class ActionConfirmationModal {
  @Input() isOpen = false;
  @Input() isBusy = false;
  @Input() config: ActionConfirmationModalConfig | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() confirmed = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (!this.isOpen || this.isBusy) {
      return;
    }

    this.closed.emit();
  }

  get confirmButtonClasses(): string {
    const tone = this.config?.tone ?? 'primary';

    return tone === 'danger'
      ? 'inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60'
      : 'inline-flex items-center justify-center rounded-xl bg-(--color-1) px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-(--color-3) disabled:cursor-not-allowed disabled:opacity-60';
  }

  get iconContainerClasses(): string {
    const tone = this.config?.tone ?? 'primary';

    return tone === 'danger'
      ? 'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100'
      : 'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-(--color-4) text-(--color-1) ring-1 ring-(--color-4)';
  }

  get eyebrowClasses(): string {
    const tone = this.config?.tone ?? 'primary';

    return tone === 'danger'
      ? 'text-xs font-semibold uppercase tracking-[0.18em] text-red-600'
      : 'text-xs font-semibold uppercase tracking-[0.18em] text-(--color-1)';
  }

  closeModal(): void {
    if (this.isBusy) {
      return;
    }

    this.closed.emit();
  }

  confirmAction(): void {
    if (this.isBusy) {
      return;
    }

    this.confirmed.emit();
  }
}
