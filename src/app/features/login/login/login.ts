import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { LoginService } from '../../../core/login.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  loginForm: FormGroup<{
    email: FormControl<string>;
    senha: FormControl<string>;
  }>;
  recoveryForm: FormGroup<{
    email: FormControl<string>;
  }>;

  isPasswordVisible = false;
  isLoading = false;
  isRecoveryMode = false;
  isSendingRecovery = false;
  errorMessage: string | null = null;
  recoveryMessage: string | null = null;

  constructor(
    private readonly fb: FormBuilder,
    private readonly loginService: LoginService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {
    this.loginForm = this.fb.nonNullable.group({
      email: ['', [
        Validators.required,
        Validators.email,
      ]],
      senha: ['', [
        Validators.required,
        Validators.minLength(6),
      ]],
    });

    this.recoveryForm = this.fb.nonNullable.group({
      email: ['', [
        Validators.required,
        Validators.email,
      ]],
    });
  }

  togglePassword(): void {
    this.isPasswordVisible = !this.isPasswordVisible;
  }

  openRecovery(): void {
    const email = this.loginForm.controls.email.value.trim();
    this.recoveryForm.patchValue({ email });
    this.errorMessage = null;
    this.recoveryMessage = null;
    this.isRecoveryMode = true;
  }

  closeRecovery(): void {
    this.errorMessage = null;
    this.recoveryMessage = null;
    this.isRecoveryMode = false;
  }

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;

    const { email, senha } = this.loginForm.getRawValue();

    this.loginService.login({ email, password: senha }).subscribe({
      next: (response) => {
        this.loginService.persistSession(response);
        this.isLoading = false;
        this.router.navigateByUrl(this.getReturnUrl());
      },
      error: (err) => {
        this.isLoading = false;

        if (err.status === 400 || err.status === 401) {
          this.errorMessage = 'E-mail ou senha incorretos.';
        } else {
          this.errorMessage = 'Ocorreu um erro no servidor. Tente mais tarde.';
        }

        console.error('Erro na API:', err);
      },
    });
  }

  sendRecoveryEmail(): void {
    if (this.recoveryForm.invalid) {
      this.recoveryForm.markAllAsTouched();
      return;
    }

    this.isSendingRecovery = true;
    this.errorMessage = null;
    this.recoveryMessage = null;

    const { email } = this.recoveryForm.getRawValue();

    this.loginService
      .requestPasswordReset({ email })
      .pipe(finalize(() => {
        this.isSendingRecovery = false;
      }))
      .subscribe({
        next: (response) => {
          this.recoveryMessage = response.mensagem ?? 'Se o e-mail estiver cadastrado, voce recebera um link de redefinicao.';
        },
        error: (error: unknown) => {
          this.errorMessage = this.extractErrorMessage(error) || 'Nao foi possivel solicitar a recuperacao de senha.';
          console.error('Erro ao solicitar recuperacao de senha:', error);
        },
      });
  }

  private getReturnUrl(): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (!returnUrl || !returnUrl.startsWith('/') || returnUrl.startsWith('//')) {
      return '/artigos';
    }

    return returnUrl;
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
