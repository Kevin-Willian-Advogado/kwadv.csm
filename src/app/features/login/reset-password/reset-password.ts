import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { LoginService } from '../../../core/login.service';

@Component({
  selector: 'app-reset-password',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.css',
})
export class ResetPassword implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly loginService = inject(LoginService);
  private readonly router = inject(Router);

  readonly form = this.formBuilder.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(6)]],
    passwordConfirmation: ['', [Validators.required]],
  });

  accessToken = '';
  tokenHash = '';
  isSaving = false;
  errorMessage = '';
  feedbackMessage = '';

  ngOnInit(): void {
    const recoveryToken = this.readRecoveryTokenFromUrl();
    this.accessToken = recoveryToken.accessToken;
    this.tokenHash = recoveryToken.tokenHash;

    if (!this.hasRecoveryToken) {
      this.errorMessage = 'Link de redefinicao invalido ou expirado.';
    }
  }

  get hasRecoveryToken(): boolean {
    return !!this.accessToken || !!this.tokenHash;
  }

  get passwordsDoNotMatch(): boolean {
    return this.form.controls.password.value.trim() !== this.form.controls.passwordConfirmation.value.trim();
  }

  updatePassword(): void {
    this.errorMessage = '';
    this.feedbackMessage = '';
    this.form.markAllAsTouched();

    if (!this.hasRecoveryToken) {
      this.errorMessage = 'Link de redefinicao invalido ou expirado.';
      return;
    }

    if (this.form.invalid || this.passwordsDoNotMatch) {
      this.errorMessage = this.passwordsDoNotMatch
        ? 'A confirmacao de senha precisa ser igual a senha.'
        : 'Informe uma senha com pelo menos 6 caracteres.';
      return;
    }

    this.isSaving = true;

    this.loginService
      .updatePassword({
        accessToken: this.accessToken || undefined,
        tokenHash: this.tokenHash || undefined,
        password: this.form.controls.password.value.trim(),
      })
      .pipe(finalize(() => {
        this.isSaving = false;
      }))
      .subscribe({
        next: (response) => {
          this.feedbackMessage = response.mensagem ?? 'Senha atualizada com sucesso.';
          this.form.reset();
          this.loginService.clearSession();
          this.router.navigate(['/login'], {
            queryParams: { passwordUpdated: '1' },
            replaceUrl: true,
          });
        },
        error: (error: unknown) => {
          this.errorMessage = this.extractErrorMessage(error) || 'Nao foi possivel atualizar a senha.';
          console.error('Erro ao atualizar senha:', error);
        },
      });
  }

  private readRecoveryTokenFromUrl(): { accessToken: string; tokenHash: string } {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const queryParams = new URLSearchParams(window.location.search);

    return {
      accessToken: hashParams.get('access_token')?.trim() ||
        queryParams.get('access_token')?.trim() ||
        '',
      tokenHash: queryParams.get('token_hash')?.trim() ||
        queryParams.get('token')?.trim() ||
        hashParams.get('token_hash')?.trim() ||
        hashParams.get('token')?.trim() ||
        '',
    };
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
