import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { LoginService } from '../../../core/login.service';

@Component({
  selector: 'app-validate-email',
  imports: [CommonModule, RouterLink],
  templateUrl: './validate-email.html',
  styleUrl: './validate-email.css',
})
export class ValidateEmail implements OnInit, OnDestroy {
  private readonly loginService = inject(LoginService);
  private readonly router = inject(Router);
  private redirectTimeoutId: number | null = null;

  isValidating = true;
  errorMessage = '';
  feedbackMessage = '';

  ngOnInit(): void {
    const tokenHash = this.readTokenHashFromUrl();

    if (!tokenHash) {
      this.isValidating = false;
      this.errorMessage = 'Link de validacao invalido ou expirado.';
      return;
    }

    this.loginService
      .verifyEmailChange({ tokenHash })
      .pipe(finalize(() => {
        this.isValidating = false;
      }))
      .subscribe({
        next: (response) => {
          this.feedbackMessage = response.mensagem ?? 'E-mail validado com sucesso.';
          this.loginService.clearSession();
          window.history.replaceState(null, document.title, '/validar-email');
          this.redirectTimeoutId = window.setTimeout(() => {
            this.router.navigate(['/login'], {
              queryParams: { emailValidated: '1' },
              replaceUrl: true,
            });
          }, 1400);
        },
        error: (error: unknown) => {
          this.errorMessage = this.extractErrorMessage(error) || 'Nao foi possivel validar o novo e-mail.';
          console.error('Erro ao validar novo e-mail:', error);
        },
      });
  }

  ngOnDestroy(): void {
    if (this.redirectTimeoutId !== null) {
      window.clearTimeout(this.redirectTimeoutId);
    }
  }

  private readTokenHashFromUrl(): string {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const queryParams = new URLSearchParams(window.location.search);

    return queryParams.get('token_hash')?.trim() ||
      queryParams.get('token')?.trim() ||
      hashParams.get('token_hash')?.trim() ||
      hashParams.get('token')?.trim() ||
      '';
  }

  private extractErrorMessage(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return '';
    }

    const record = error as Record<string, unknown>;
    const nested = record['error'];

    if (typeof nested === 'string' && nested.trim()) {
      return nested.trim();
    }

    if (nested && typeof nested === 'object') {
      const nestedRecord = nested as Record<string, unknown>;
      const nestedMessage = [
        nestedRecord['message'],
        nestedRecord['error'],
        nestedRecord['erro'],
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ');

      if (nestedMessage) {
        return nestedMessage;
      }
    }

    return [
      record['message'],
      record['error'],
      record['erro'],
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ');
  }
}
