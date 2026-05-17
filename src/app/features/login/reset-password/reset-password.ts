import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { LoginService } from '../../../core/login.service';

type ResetPasswordMode = 'recovery' | 'user_setup';

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
  mode: ResetPasswordMode = 'recovery';
  isSaving = false;
  errorMessage = '';
  feedbackMessage = '';

  ngOnInit(): void {
    const actionToken = this.readActionTokenFromUrl();
    this.accessToken = actionToken.accessToken;
    this.tokenHash = actionToken.tokenHash;
    this.mode = actionToken.mode;

    if (!this.hasRecoveryToken) {
      this.errorMessage = this.invalidLinkMessage;
    }
  }

  get hasRecoveryToken(): boolean {
    if (this.mode === 'user_setup') {
      return !!this.tokenHash;
    }

    return !!this.accessToken || !!this.tokenHash;
  }

  get pageTitle(): string {
    return this.mode === 'user_setup' ? 'Definir senha' : 'Redefinir senha';
  }

  get pageDescription(): string {
    return this.mode === 'user_setup'
      ? 'Valide seu e-mail e crie sua senha de acesso'
      : 'Crie uma nova senha de acesso';
  }

  get passwordLabel(): string {
    return this.mode === 'user_setup' ? 'Senha de acesso' : 'Nova senha';
  }

  get submitLabel(): string {
    return this.mode === 'user_setup' ? 'Validar e definir senha' : 'Atualizar senha';
  }

  get savingLabel(): string {
    return this.mode === 'user_setup' ? 'Validando...' : 'Atualizando...';
  }

  get passwordsDoNotMatch(): boolean {
    return this.form.controls.password.value.trim() !== this.form.controls.passwordConfirmation.value.trim();
  }

  updatePassword(): void {
    this.errorMessage = '';
    this.feedbackMessage = '';
    this.form.markAllAsTouched();

    if (!this.hasRecoveryToken) {
      this.errorMessage = this.invalidLinkMessage;
      return;
    }

    if (this.form.invalid || this.passwordsDoNotMatch) {
      this.errorMessage = this.passwordsDoNotMatch
        ? 'A confirmacao de senha precisa ser igual a senha.'
        : 'Informe uma senha com pelo menos 6 caracteres.';
      return;
    }

    this.isSaving = true;

    const password = this.form.controls.password.value.trim();
    const request = this.mode === 'user_setup'
      ? this.loginService.completeUserSetup({
        tokenHash: this.tokenHash,
        password,
      })
      : this.loginService.updatePassword({
        accessToken: this.accessToken || undefined,
        tokenHash: this.tokenHash || undefined,
        password,
      });

    request
      .pipe(finalize(() => {
        this.isSaving = false;
      }))
      .subscribe({
        next: (response) => {
          this.feedbackMessage = response.mensagem ?? (
            this.mode === 'user_setup'
              ? 'E-mail validado e senha definida com sucesso.'
              : 'Senha atualizada com sucesso.'
          );
          this.form.reset();
          this.loginService.clearSession();
          this.router.navigate(['/login'], {
            queryParams: this.mode === 'user_setup'
              ? { userSetup: '1' }
              : { passwordUpdated: '1' },
            replaceUrl: true,
          });
        },
        error: (error: unknown) => {
          this.errorMessage = this.extractErrorMessage(error) || this.genericErrorMessage;
          console.error('Erro ao atualizar senha:', error);
        },
      });
  }

  private get invalidLinkMessage(): string {
    return this.mode === 'user_setup'
      ? 'Link de criacao de usuario invalido ou expirado.'
      : 'Link de redefinicao invalido ou expirado.';
  }

  private get genericErrorMessage(): string {
    return this.mode === 'user_setup'
      ? 'Nao foi possivel validar o e-mail e definir a senha.'
      : 'Nao foi possivel atualizar a senha.';
  }

  private readActionTokenFromUrl(): { accessToken: string; tokenHash: string; mode: ResetPasswordMode } {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const queryParams = new URLSearchParams(window.location.search);
    const type = queryParams.get('type')?.trim() ||
      hashParams.get('type')?.trim() ||
      '';

    return {
      accessToken: hashParams.get('access_token')?.trim() ||
        queryParams.get('access_token')?.trim() ||
        '',
      tokenHash: queryParams.get('token_hash')?.trim() ||
        queryParams.get('token')?.trim() ||
        hashParams.get('token_hash')?.trim() ||
        hashParams.get('token')?.trim() ||
        '',
      mode: type === 'user_setup' ? 'user_setup' : 'recovery',
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
