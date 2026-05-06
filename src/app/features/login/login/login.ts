import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
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

  isPasswordVisible = false;
  isLoading = false;
  errorMessage: string | null = null;

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
        Validators.maxLength(10),
      ]],
    });
  }

  togglePassword(): void {
    this.isPasswordVisible = !this.isPasswordVisible;
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

  private getReturnUrl(): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (!returnUrl || !returnUrl.startsWith('/') || returnUrl.startsWith('//')) {
      return '/artigos';
    }

    return returnUrl;
  }
}
