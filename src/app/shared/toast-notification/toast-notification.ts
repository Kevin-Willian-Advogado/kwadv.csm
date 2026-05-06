import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';

export type ToastNotificationType = 'success' | 'error' | 'info';

@Component({
  selector: 'app-toast-notification',
  imports: [CommonModule],
  templateUrl: './toast-notification.html',
  styleUrl: './toast-notification.css',
})
export class ToastNotification implements OnInit, OnDestroy {
  @Input() type: ToastNotificationType = 'success';
  @Input() title = '';
  @Input() messages: string[] = [];
  @Input() autoCloseMs = 0;
  @Output() close = new EventEmitter<void>();

  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.startAutoClose();
  }

  ngOnDestroy(): void {
    this.clearAutoClose();
  }

  onClose(): void {
    this.clearAutoClose();
    this.close.emit();
  }

  private startAutoClose(): void {
    if (this.autoCloseMs <= 0) {
      return;
    }

    this.timeoutId = setTimeout(() => this.onClose(), this.autoCloseMs);
  }

  private clearAutoClose(): void {
    if (this.timeoutId === null) {
      return;
    }

    clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }
}
