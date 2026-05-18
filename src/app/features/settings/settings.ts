import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { catchError, finalize, map, of, switchMap } from 'rxjs';

import {
  EmailProvider,
  SettingsService,
  SiteSettings,
  SiteSettingsPayload,
  SmtpSecurity,
} from '../../core/settings.service';
import { ArticlePublicationService } from '../../core/article-publication.service';
import {
  ActionConfirmationModal,
  ActionConfirmationModalConfig,
} from '../../shared/modal/action-confirmation-modal/action-confirmation-modal';

type SettingsSaveSection = 'articles' | 'contact' | 'email';
type EmailAliasFlow = 'userCreation' | 'passwordChange' | 'emailChange' | 'contactClient';
type EmailProviderOption = {
  value: EmailProvider;
  label: string;
  description: string;
  detail: string;
};

@Component({
  selector: 'app-settings',
  imports: [ActionConfirmationModal, CommonModule, ReactiveFormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly settingsService = inject(SettingsService);
  private readonly articlePublicationService = inject(ArticlePublicationService);

  readonly form = this.formBuilder.nonNullable.group({
    articlesEnabled: [true],
    contactPhoneWhatsapp: ['', [Validators.maxLength(40), phoneValidator]],
    contactEmail: ['', [Validators.email, Validators.maxLength(180)]],
    instagramUrl: ['', [Validators.maxLength(300), instagramValidator]],
    linkedinUrl: ['', [Validators.maxLength(300), urlValidator]],
    passwordRecoverySenderEmail: ['', [Validators.email, Validators.maxLength(180)]],
    userValidationSenderEmail: ['', [Validators.email, Validators.maxLength(180)]],
    emailChangeSenderEmail: ['', [Validators.email, Validators.maxLength(180)]],
    contactFormSenderEmail: ['', [Validators.email, Validators.maxLength(180)]],
    contactNotificationRecipients: ['', [Validators.maxLength(1200), recipientsValidator(true)]],
    contactNotificationCcRecipients: ['', [Validators.maxLength(1200), recipientsValidator(false)]],
    emailProvider: ['disabled' as EmailProvider],
    emailFromName: ['Kevin Willian Advogado', [Validators.required, Validators.maxLength(120)]],
    emailFromAddress: ['', [Validators.required, Validators.email, Validators.maxLength(180)]],
    emailReplyToEmail: ['', [Validators.email, Validators.maxLength(180)]],
    emailSmtpHost: ['', [Validators.maxLength(180), smtpHostValidator]],
    emailSmtpPort: [587, [Validators.required, Validators.min(1), Validators.max(65535)]],
    emailSmtpSecurity: ['starttls' as SmtpSecurity],
    emailSmtpUsername: ['', [Validators.maxLength(180)]],
    emailSmtpPassword: ['', [Validators.maxLength(300)]],
    emailTestRecipient: ['', [Validators.email, Validators.maxLength(180)]],
  });

  readonly emailProviders: EmailProviderOption[] = [
    {
      value: 'disabled',
      label: 'Desativado',
      description: 'Registra mensagens, mas nao dispara e-mails.',
      detail: 'Use enquanto o provedor definitivo ainda nao foi configurado.',
    },
    {
      value: 'gmail',
      label: 'Gmail',
      description: 'Uma conta Google ou Workspace para todo o sistema.',
      detail: 'Contas com verificacao em duas etapas exigem senha de app.',
    },
    {
      value: 'microsoft',
      label: 'Outlook / Microsoft 365',
      description: 'Uma conta Outlook, Hotmail ou Microsoft 365 global.',
      detail: 'Usa autenticacao SMTP da Microsoft ou configuracao equivalente implementada.',
    },
    {
      value: 'smtp',
      label: 'SMTP',
      description: 'Servidor SMTP com aliases por funcionalidade.',
      detail: 'Indicado para dominio proprio e multiplos remetentes, como contato@ e no-reply@.',
    },
  ];
  isLoading = true;
  isSaving = false;
  isTestingEmail = false;
  isContactInfoOpen = false;
  isEmailConfigOpen = false;
  isEmailPasswordVisible = false;
  openEmailAliasFlow: EmailAliasFlow | null = null;
  errorMessage = '';
  feedbackMessage = '';
  emailTestErrorMessage = '';
  emailTestFeedbackMessage = '';
  canRetryLoad = false;
  lastUpdatedAt: string | null = null;
  pendingSaveSection: SettingsSaveSection | null = null;
  pendingArticlesEnabled: boolean | null = null;
  confirmationConfig: ActionConfirmationModalConfig | null = null;
  loadedSettings: SiteSettings | null = null;

  ngOnInit(): void {
    this.loadSettings();
  }

  get articlesEnabled(): boolean {
    return this.form.controls.articlesEnabled.value;
  }

  get selectedEmailProvider(): EmailProvider {
    return this.form.controls.emailProvider.value;
  }

  get isEmailDisabled(): boolean {
    return this.selectedEmailProvider === 'disabled';
  }

  get requiresEmailCredentials(): boolean {
    return !this.isEmailDisabled;
  }

  get usesCustomSmtp(): boolean {
    return this.selectedEmailProvider === 'smtp';
  }

  get usesFeatureSenderAliases(): boolean {
    return this.providerUsesFeatureSenderAliases(this.selectedEmailProvider);
  }

  get selectedProviderOption(): EmailProviderOption | undefined {
    return this.emailProviders.find((provider) => provider.value === this.selectedEmailProvider);
  }

  get activeEmailProvider(): EmailProvider {
    return this.loadedSettings?.emailProvider ?? this.selectedEmailProvider;
  }

  get activeProviderOption(): EmailProviderOption | undefined {
    return this.emailProviders.find((provider) => provider.value === this.activeEmailProvider);
  }

  get activeProviderStatusLabel(): string {
    if (this.activeEmailProvider === 'disabled') {
      return 'Envio desativado';
    }

    return `${this.activeProviderOption?.label ?? 'Provedor'} ativo`;
  }

  get activeProviderStatusClasses(): string {
    if (this.activeEmailProvider === 'disabled') {
      return 'bg-slate-100 text-slate-600';
    }

    if (this.activeEmailProvider === 'smtp') {
      return 'bg-orange-50 text-orange-700';
    }

    return 'bg-emerald-50 text-emerald-700';
  }

  get activeSenderLabel(): string {
    if (this.activeEmailProvider === 'disabled') {
      return 'Nenhuma conta ativa';
    }

    return this.loadedSettings?.emailFromAddress || 'Conta principal nao configurada';
  }

  get providerAccountLabel(): string {
    if (this.selectedEmailProvider === 'smtp') {
      return 'E-mail remetente padrao';
    }

    if (this.selectedEmailProvider === 'disabled') {
      return 'E-mail padrao';
    }

    return 'Conta global de envio';
  }

  get providerPasswordLabel(): string {
    if (this.selectedEmailProvider === 'gmail') {
      return 'Senha de app';
    }

    if (this.selectedEmailProvider === 'microsoft') {
      return 'Senha SMTP';
    }

    return 'Senha SMTP';
  }

  get providerPasswordHelp(): string {
    if (this.selectedEmailProvider === 'gmail') {
      return 'No Gmail, use uma senha de app. A senha normal da conta nao funciona com SMTP quando ha 2FA.';
    }

    if (this.selectedEmailProvider === 'microsoft') {
      return 'Em contas Microsoft, SMTP autenticado precisa estar liberado na conta ou no tenant.';
    }

    if (this.selectedEmailProvider === 'smtp') {
      return 'A senha fica criptografada e nao sera exibida novamente.';
    }

    return 'Nenhuma credencial sera usada enquanto o envio estiver desativado.';
  }

  get emailPasswordConfigured(): boolean {
    return this.loadedSettings?.emailSmtpPasswordConfigured === true;
  }

  get canSendEmailTest(): boolean {
    return !this.isEmailDisabled && !this.isSaving && !this.isTestingEmail;
  }

  requestArticlesToggle(): void {
    this.errorMessage = '';
    this.feedbackMessage = '';
    this.canRetryLoad = false;
    this.pendingArticlesEnabled = !this.articlesEnabled;
    this.pendingSaveSection = 'articles';
    this.confirmationConfig = this.buildConfirmationConfig('articles');
  }

  selectEmailProvider(provider: EmailProvider): void {
    this.emailTestErrorMessage = '';
    this.emailTestFeedbackMessage = '';
    this.form.controls.emailProvider.setValue(provider);

    if (provider === 'gmail') {
      this.form.controls.emailSmtpHost.setValue('smtp.gmail.com');
      this.form.controls.emailSmtpPort.setValue(587);
      this.form.controls.emailSmtpSecurity.setValue('starttls');
      this.syncUsernameWithFromAddress(true);
    }

    if (provider === 'microsoft') {
      this.form.controls.emailSmtpHost.setValue('smtp.office365.com');
      this.form.controls.emailSmtpPort.setValue(587);
      this.form.controls.emailSmtpSecurity.setValue('starttls');
      this.syncUsernameWithFromAddress(true);
    }

    if (provider === 'disabled') {
      this.form.controls.emailSmtpPassword.setValue('');
      this.isEmailPasswordVisible = false;
    }

    if (!this.providerUsesFeatureSenderAliases(provider)) {
      this.syncFeatureSenderControlsToGlobal();
      this.openEmailAliasFlow = null;
    }
  }

  toggleContactInfo(): void {
    this.isContactInfoOpen = !this.isContactInfoOpen;
  }

  toggleEmailConfig(): void {
    this.isEmailConfigOpen = !this.isEmailConfigOpen;
  }

  toggleEmailAliasFlow(flow: EmailAliasFlow): void {
    this.openEmailAliasFlow = this.openEmailAliasFlow === flow ? null : flow;
  }

  toggleEmailPasswordVisibility(): void {
    this.isEmailPasswordVisible = !this.isEmailPasswordVisible;
  }

  formatContactPhoneInput(): void {
    const control = this.form.controls.contactPhoneWhatsapp;
    const formattedValue = formatBrazilianPhone(control.value);

    if (formattedValue !== control.value) {
      control.setValue(formattedValue, { emitEvent: false });
    }
  }

  normalizeInstagramInput(): void {
    const control = this.form.controls.instagramUrl;
    const normalizedValue = normalizeInstagramValue(control.value);

    if (normalizedValue !== control.value) {
      control.setValue(normalizedValue, { emitEvent: false });
    }
  }

  normalizeLinkedinInput(): void {
    const control = this.form.controls.linkedinUrl;
    const normalizedValue = normalizeUrlValue(control.value);

    if (normalizedValue !== control.value) {
      control.setValue(normalizedValue, { emitEvent: false });
    }
  }

  normalizeEmailControl(
    controlName:
      | 'contactEmail'
      | 'emailFromAddress'
      | 'emailReplyToEmail'
      | 'emailTestRecipient'
      | 'passwordRecoverySenderEmail'
      | 'userValidationSenderEmail'
      | 'emailChangeSenderEmail'
      | 'contactFormSenderEmail',
  ): void {
    const control = this.form.controls[controlName];
    const normalizedValue = control.value.trim().toLowerCase();

    if (normalizedValue !== control.value) {
      control.setValue(normalizedValue, { emitEvent: false });
    }
  }

  normalizeRecipientsControl(
    controlName: 'contactNotificationRecipients' | 'contactNotificationCcRecipients',
  ): void {
    const control = this.form.controls[controlName];
    const normalizedValue = this.parseRecipients(control.value).join('\n');

    if (normalizedValue !== control.value) {
      control.setValue(normalizedValue, { emitEvent: false });
    }
  }

  syncKnownProviderSender(): void {
    this.normalizeEmailControl('emailFromAddress');

    if (!this.usesFeatureSenderAliases) {
      this.syncUsernameWithFromAddress(true);
      this.syncFeatureSenderControlsToGlobal();
    }
  }

  requestSave(section: SettingsSaveSection): void {
    this.errorMessage = '';
    this.feedbackMessage = '';
    this.emailTestErrorMessage = '';
    this.emailTestFeedbackMessage = '';
    this.canRetryLoad = false;

    if (!this.validateSection(section)) {
      return;
    }

    this.pendingSaveSection = section;
    this.confirmationConfig = this.buildConfirmationConfig(section);
  }

  testEmailSettings(): void {
    this.errorMessage = '';
    this.feedbackMessage = '';
    this.emailTestErrorMessage = '';
    this.emailTestFeedbackMessage = '';
    this.canRetryLoad = false;

    if (this.isEmailDisabled) {
      this.emailTestErrorMessage = 'Ative um metodo de envio antes de enviar um teste.';
      return;
    }

    const testRecipient = this.form.controls.emailTestRecipient.value.trim();

    this.form.controls.emailTestRecipient.markAsTouched();
    if (!testRecipient || this.form.controls.emailTestRecipient.invalid) {
      this.emailTestErrorMessage = 'Informe um destinatario valido para o teste.';
      return;
    }

    if (this.hasUnsavedEmailConfiguration()) {
      this.emailTestErrorMessage = 'Salve as configuracoes antes de enviar o teste.';
      return;
    }

    const payload: SiteSettingsPayload = {
      emailTestRecipient: testRecipient,
    };
    this.isTestingEmail = true;

    this.settingsService
      .testEmailSettings(payload)
      .pipe(finalize(() => {
        this.isTestingEmail = false;
      }))
      .subscribe({
        next: ({ settings, sent, error }) => {
          this.loadedSettings = settings;
          this.lastUpdatedAt = settings.updatedAt;
          this.patchForm(settings);
          this.emailTestFeedbackMessage = sent
            ? 'E-mail de teste enviado com sucesso.'
            : '';
          this.emailTestErrorMessage = sent
            ? ''
            : this.formatEmailTestError(error);
          this.form.markAsPristine();
        },
        error: (error: unknown) => {
          this.emailTestErrorMessage = this.formatEmailTestError(this.extractErrorMessage(error));
          console.error('Erro ao testar e-mail:', error);
        },
      });
  }

  closeConfirmation(): void {
    if (this.isSaving) {
      return;
    }

    this.pendingSaveSection = null;
    this.pendingArticlesEnabled = null;
    this.confirmationConfig = null;
  }

  confirmSave(): void {
    if (!this.pendingSaveSection || !this.validateSection(this.pendingSaveSection)) {
      return;
    }

    const section = this.pendingSaveSection;
    const previousArticlesEnabled = this.articlesEnabled;
    let payload = this.buildPayload(section);

    if (section === 'articles') {
      const targetArticlesEnabled = this.pendingArticlesEnabled ?? !this.articlesEnabled;
      payload = { articlesEnabled: targetArticlesEnabled };
      this.form.controls.articlesEnabled.setValue(targetArticlesEnabled);
    }

    this.isSaving = true;

    this.settingsService
      .saveSettings(payload)
      .pipe(
        switchMap((settings) => {
          if (!this.shouldQueueBuildAfterSave(section)) {
            return of({ settings, buildQueued: false, buildAttempted: false });
          }

          return this.articlePublicationService
            .dispatchContentRefresh({
              entityType: 'settings',
              entityId: 1,
              operation: 'update',
              updatedAt: settings.updatedAt ?? new Date().toISOString(),
            })
            .pipe(
              map(() => ({ settings, buildQueued: true, buildAttempted: true })),
              catchError((error: unknown) => {
                console.warn('Nao foi possivel acionar a Action apos salvar configuracoes:', error);
                return of({ settings, buildQueued: false, buildAttempted: true });
              }),
            );
        }),
      )
      .pipe(finalize(() => {
        this.isSaving = false;
      }))
      .subscribe({
        next: ({ settings, buildQueued, buildAttempted }) => {
          this.lastUpdatedAt = settings.updatedAt;
          this.loadedSettings = settings;
          this.patchForm(settings);
          this.feedbackMessage = this.getSaveFeedbackMessage(section, buildQueued, buildAttempted);
          this.form.markAsPristine();
          this.pendingSaveSection = null;
          this.pendingArticlesEnabled = null;
          this.confirmationConfig = null;
        },
        error: (error: unknown) => {
          if (section === 'articles') {
            this.form.controls.articlesEnabled.setValue(previousArticlesEnabled);
          }

          this.errorMessage = this.extractErrorMessage(error) || 'Nao foi possivel salvar as configuracoes.';
          console.error('Erro ao salvar configuracoes:', error);
        },
      });
  }

  retryLoad(): void {
    this.loadSettings(true);
  }

  private loadSettings(forceRefresh = false): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.feedbackMessage = '';
    this.canRetryLoad = false;

    this.settingsService
      .getSettings(forceRefresh)
      .pipe(finalize(() => {
        this.isLoading = false;
      }))
      .subscribe({
        next: (settings) => {
          this.lastUpdatedAt = settings.updatedAt;
          this.loadedSettings = settings;
          this.patchForm(settings);
          this.canRetryLoad = false;
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel carregar as configuracoes.';
          this.canRetryLoad = true;
          console.error('Erro ao carregar configuracoes:', error);
        },
      });
  }

  private patchForm(settings: SiteSettings): void {
    const globalSender = settings.emailFromAddress || 'washingtonlopes2003@gmail.com';
    const usesAliases = this.providerUsesFeatureSenderAliases(settings.emailProvider);

    this.form.reset({
      articlesEnabled: settings.articlesEnabled,
      contactPhoneWhatsapp: settings.contactPhoneWhatsapp,
      contactEmail: settings.contactEmail,
      instagramUrl: settings.instagramUrl,
      linkedinUrl: settings.linkedinUrl,
      passwordRecoverySenderEmail: usesAliases ? settings.passwordRecoverySenderEmail : globalSender,
      userValidationSenderEmail: usesAliases ? settings.userValidationSenderEmail : globalSender,
      emailChangeSenderEmail: usesAliases ? settings.emailChangeSenderEmail : globalSender,
      contactFormSenderEmail: usesAliases ? settings.contactFormSenderEmail : globalSender,
      contactNotificationRecipients: settings.contactNotificationRecipients.join('\n'),
      contactNotificationCcRecipients: settings.contactNotificationCcRecipients.join('\n'),
      emailProvider: settings.emailProvider,
      emailFromName: settings.emailFromName,
      emailFromAddress: settings.emailFromAddress,
      emailReplyToEmail: settings.emailReplyToEmail,
      emailSmtpHost: settings.emailSmtpHost,
      emailSmtpPort: settings.emailSmtpPort,
      emailSmtpSecurity: settings.emailSmtpSecurity,
      emailSmtpUsername: settings.emailSmtpUsername,
      emailSmtpPassword: '',
      emailTestRecipient: settings.contactEmail || settings.emailFromAddress,
    });
  }

  private buildPayload(section: SettingsSaveSection | null): SiteSettingsPayload {
    const rawValue = this.form.getRawValue();

    if (section === 'articles') {
      return {
        articlesEnabled: rawValue.articlesEnabled,
      };
    }

    if (section === 'contact') {
      return {
        contactPhoneWhatsapp: rawValue.contactPhoneWhatsapp.trim(),
        contactEmail: rawValue.contactEmail.trim(),
        instagramUrl: rawValue.instagramUrl.trim(),
        linkedinUrl: rawValue.linkedinUrl.trim(),
      };
    }

    if (section === 'email') {
      const fromAddress = rawValue.emailFromAddress.trim();
      const usesAliases = this.providerUsesFeatureSenderAliases(rawValue.emailProvider);
      const senderFallback = fromAddress || 'washingtonlopes2003@gmail.com';

      if (rawValue.emailProvider === 'disabled') {
        return {
          emailProvider: rawValue.emailProvider,
        };
      }

      const passwordRecoverySenderEmail = usesAliases
        ? rawValue.passwordRecoverySenderEmail.trim() || senderFallback
        : fromAddress;
      const userValidationSenderEmail = usesAliases
        ? rawValue.userValidationSenderEmail.trim() || senderFallback
        : fromAddress;
      const emailChangeSenderEmail = usesAliases
        ? rawValue.emailChangeSenderEmail.trim() || senderFallback
        : fromAddress;
      const contactFormSenderEmail = usesAliases
        ? rawValue.contactFormSenderEmail.trim() || senderFallback
        : fromAddress;
      const smtpUsername = this.providerRequiresSmtpSettings(rawValue.emailProvider)
        ? rawValue.emailSmtpUsername.trim()
        : fromAddress;
      const payload: SiteSettingsPayload = {
        emailProvider: rawValue.emailProvider,
        emailFromName: rawValue.emailFromName.trim(),
        emailFromAddress: fromAddress,
        emailReplyToEmail: rawValue.emailReplyToEmail.trim(),
        emailSmtpHost: rawValue.emailSmtpHost.trim(),
        emailSmtpPort: Number(rawValue.emailSmtpPort),
        emailSmtpSecurity: rawValue.emailSmtpSecurity,
        emailSmtpUsername: smtpUsername,
        emailSmtpPassword: rawValue.emailSmtpPassword,
        emailTestRecipient: rawValue.emailTestRecipient.trim(),
      };

      if (usesAliases) {
        payload.passwordRecoverySenderEmail = passwordRecoverySenderEmail;
        payload.userValidationSenderEmail = userValidationSenderEmail;
        payload.emailChangeSenderEmail = emailChangeSenderEmail;
        payload.contactFormSenderEmail = contactFormSenderEmail;
        payload.contactConfirmationSenderEmail = contactFormSenderEmail;
        payload.contactNotificationSenderEmail = contactFormSenderEmail;
        payload.contactNotificationRecipients = this.parseRecipients(rawValue.contactNotificationRecipients);
        payload.contactNotificationCcRecipients = this.parseRecipients(rawValue.contactNotificationCcRecipients);
      }

      return payload;
    }

    return {};
  }

  private validateSection(section: SettingsSaveSection): boolean {
    if (section === 'contact') {
      this.formatContactPhoneInput();
      this.normalizeEmailControl('contactEmail');
      this.normalizeInstagramInput();
      this.normalizeLinkedinInput();

      const controls: AbstractControl[] = [
        this.form.controls.contactPhoneWhatsapp,
        this.form.controls.contactEmail,
        this.form.controls.instagramUrl,
        this.form.controls.linkedinUrl,
      ];
      controls.forEach((control) => control.markAsTouched());

      if (controls.some((control) => control.invalid)) {
        this.errorMessage = 'Revise as informacoes de contato antes de salvar.';
        return false;
      }
    }

    if (section === 'email') {
      this.normalizeEmailControl('emailFromAddress');
      this.normalizeEmailControl('emailReplyToEmail');
      this.normalizeEmailControl('emailTestRecipient');
      this.normalizeEmailControl('passwordRecoverySenderEmail');
      this.normalizeEmailControl('userValidationSenderEmail');
      this.normalizeEmailControl('emailChangeSenderEmail');
      this.normalizeEmailControl('contactFormSenderEmail');
      this.normalizeRecipientsControl('contactNotificationRecipients');
      this.normalizeRecipientsControl('contactNotificationCcRecipients');

      if (this.isEmailDisabled) {
        this.form.controls.emailProvider.markAsTouched();
        return this.form.controls.emailProvider.valid;
      }

      if (!this.usesFeatureSenderAliases) {
        this.syncFeatureSenderControlsToGlobal();
      }

      const controls: AbstractControl[] = [
        this.form.controls.emailProvider,
        this.form.controls.emailFromName,
        this.form.controls.emailFromAddress,
        this.form.controls.emailReplyToEmail,
        this.form.controls.emailSmtpPassword,
      ];

      if (this.usesCustomSmtp) {
        controls.push(
          this.form.controls.emailSmtpHost,
          this.form.controls.emailSmtpPort,
          this.form.controls.emailSmtpSecurity,
          this.form.controls.emailSmtpUsername,
        );
      }

      if (this.usesFeatureSenderAliases) {
        controls.push(
          this.form.controls.contactNotificationRecipients,
          this.form.controls.contactNotificationCcRecipients,
          this.form.controls.passwordRecoverySenderEmail,
          this.form.controls.userValidationSenderEmail,
          this.form.controls.emailChangeSenderEmail,
          this.form.controls.contactFormSenderEmail,
        );
      }
      controls.forEach((control) => control.markAsTouched());

      if (controls.some((control) => control.invalid)) {
        this.errorMessage = 'Revise os e-mails e o provedor de envio antes de salvar.';
        if (
          this.form.controls.contactNotificationRecipients.invalid ||
          this.form.controls.contactNotificationCcRecipients.invalid
        ) {
          this.openEmailAliasFlow = 'contactClient';
        }
        return false;
      }

      if (this.requiresEmailCredentials) {
        const hasPassword = !!this.form.controls.emailSmtpPassword.value.trim() || this.emailPasswordConfigured;

        if (!this.form.controls.emailFromAddress.value.trim()) {
          this.errorMessage = 'Informe o e-mail de envio.';
          return false;
        }

        if (this.usesCustomSmtp && !this.form.controls.emailSmtpHost.value.trim()) {
          this.errorMessage = 'Informe o servidor SMTP.';
          return false;
        }

        if (this.usesCustomSmtp && !this.form.controls.emailSmtpUsername.value.trim()) {
          this.errorMessage = 'Informe o usuario de autenticacao.';
          return false;
        }

        if (!hasPassword) {
          this.errorMessage = 'Informe a senha de app ou senha SMTP.';
          return false;
        }
      }

      const invalidRecipients = this.usesFeatureSenderAliases
        ? [
            ...this.getInvalidRecipients(this.form.controls.contactNotificationRecipients.value),
            ...this.getInvalidRecipients(this.form.controls.contactNotificationCcRecipients.value),
          ]
        : [];

      if (invalidRecipients.length > 0) {
        this.errorMessage = `E-mail invalido: ${invalidRecipients[0]}`;
        return false;
      }
    }

    return true;
  }

  private getInvalidRecipients(value: string): string[] {
    return this.parseRecipients(value)
      .filter((email) => !this.isValidEmail(email));
  }

  private hasUnsavedEmailConfiguration(): boolean {
    const settings = this.loadedSettings;
    if (!settings) {
      return false;
    }

    const rawValue = this.form.getRawValue();
    const normalize = (value: string | null | undefined) => (value ?? '').trim();
    const normalizeRecipients = (value: string) => this.parseRecipients(value).join('\n');
    const normalizeRecipientArray = (value: string[]) => value.map((email) => email.trim().toLowerCase()).join('\n');

    if (normalize(rawValue.emailSmtpPassword)) {
      return true;
    }

    if (
      rawValue.emailProvider !== settings.emailProvider ||
      normalize(rawValue.emailFromName) !== normalize(settings.emailFromName) ||
      normalize(rawValue.emailFromAddress).toLowerCase() !== normalize(settings.emailFromAddress).toLowerCase() ||
      normalize(rawValue.emailReplyToEmail).toLowerCase() !== normalize(settings.emailReplyToEmail).toLowerCase()
    ) {
      return true;
    }

    if (!this.providerUsesFeatureSenderAliases(rawValue.emailProvider)) {
      return false;
    }

    const transportChanged = this.providerRequiresSmtpSettings(rawValue.emailProvider)
      ? normalize(rawValue.emailSmtpHost) !== normalize(settings.emailSmtpHost) ||
        Number(rawValue.emailSmtpPort) !== settings.emailSmtpPort ||
        rawValue.emailSmtpSecurity !== settings.emailSmtpSecurity ||
        normalize(rawValue.emailSmtpUsername) !== normalize(settings.emailSmtpUsername)
      : false;

    return (
      transportChanged ||
      normalizeRecipients(rawValue.contactNotificationRecipients) !== normalizeRecipientArray(settings.contactNotificationRecipients) ||
      normalizeRecipients(rawValue.contactNotificationCcRecipients) !== normalizeRecipientArray(settings.contactNotificationCcRecipients) ||
      normalize(rawValue.passwordRecoverySenderEmail).toLowerCase() !== normalize(settings.passwordRecoverySenderEmail).toLowerCase() ||
      normalize(rawValue.userValidationSenderEmail).toLowerCase() !== normalize(settings.userValidationSenderEmail).toLowerCase() ||
      normalize(rawValue.emailChangeSenderEmail).toLowerCase() !== normalize(settings.emailChangeSenderEmail).toLowerCase() ||
      normalize(rawValue.contactFormSenderEmail).toLowerCase() !== normalize(settings.contactFormSenderEmail).toLowerCase()
    );
  }

  private providerUsesFeatureSenderAliases(provider: EmailProvider): boolean {
    return provider === 'smtp' || provider === 'resend';
  }

  private providerRequiresSmtpSettings(provider: EmailProvider): boolean {
    return provider === 'smtp';
  }

  private formatEmailTestError(error: string | null | undefined): string {
    const message = error?.trim() || 'Nao foi possivel enviar o e-mail de teste.';
    const normalized = message.toLowerCase();

    if (
      normalized.includes('535') ||
      normalized.includes('534') ||
      normalized.includes('username and password') ||
      normalized.includes('badcredentials') ||
      normalized.includes('senha de app')
    ) {
      if (this.selectedEmailProvider === 'gmail') {
        return 'Falha na autenticação do Gmail. Verifique se você está usando uma senha de app, não a senha normal da conta.';
      }

      if (this.selectedEmailProvider === 'microsoft') {
        return 'Falha na autenticação do Outlook/Microsoft 365. Verifique a credencial e se o SMTP autenticado está liberado.';
      }

      return 'Falha na autenticação SMTP. Verifique usuário, senha, host e porta.';
    }

    return message;
  }

  private syncUsernameWithFromAddress(force = false): void {
    const fromAddress = this.form.controls.emailFromAddress.value.trim();
    const username = this.form.controls.emailSmtpUsername.value.trim();

    if (fromAddress && (force || !username)) {
      this.form.controls.emailSmtpUsername.setValue(fromAddress);
    }
  }

  private syncFeatureSenderControlsToGlobal(): void {
    const fromAddress = this.form.controls.emailFromAddress.value.trim();

    if (!fromAddress) {
      return;
    }

    this.form.controls.passwordRecoverySenderEmail.setValue(fromAddress);
    this.form.controls.userValidationSenderEmail.setValue(fromAddress);
    this.form.controls.emailChangeSenderEmail.setValue(fromAddress);
    this.form.controls.contactFormSenderEmail.setValue(fromAddress);
  }

  private buildConfirmationConfig(section: SettingsSaveSection): ActionConfirmationModalConfig {
    if (section === 'articles') {
      return {
        title: this.pendingArticlesEnabled ? 'Ativar blog?' : 'Desativar blog?',
        description: this.pendingArticlesEnabled
          ? 'Ao confirmar, os artigos ficam marcados como ativos para consumo do site.'
          : 'Ao confirmar, os artigos ficam marcados como inativos para consumo do site.',
        confirmLabel: this.pendingArticlesEnabled ? 'Ativar blog' : 'Desativar blog',
        highlights: [
          this.pendingArticlesEnabled
            ? 'O blog sera salvo como ativo imediatamente.'
            : 'O blog sera salvo como inativo imediatamente.',
        ],
      };
    }

    if (section === 'contact') {
      return {
        title: 'Salvar informacoes de contato?',
        description: 'Telefone, e-mail e redes sociais serao atualizados nas configuracoes do CMS.',
        confirmLabel: 'Salvar contato',
        highlights: ['Esses dados ficam prontos para consumo no site principal.'],
      };
    }

    return {
      title: 'Salvar configuracao de e-mails?',
      description: 'O modo de envio, remetente global, destinatarios e ajustes avancados preenchidos serao salvos.',
      confirmLabel: 'Salvar configuracoes',
      highlights: [
        'A senha de envio nao sera exibida novamente.',
        'Remetentes especificos vazios usam automaticamente a conta global.',
        'O contato de cliente usa um unico remetente para confirmacao externa e aviso interno.',
        'Depois de salvar, use o envio de teste para validar o provedor.',
      ],
    };
  }

  private getSectionLabel(section: SettingsSaveSection | null): string {
    if (section === 'articles') {
      return 'Configuracoes de artigos';
    }

    if (section === 'contact') {
      return 'Informacoes de contato';
    }

    return 'Configuracoes de e-mail';
  }

  private shouldQueueBuildAfterSave(section: SettingsSaveSection | null): boolean {
    return section === 'articles' || section === 'contact';
  }

  private getSaveFeedbackMessage(
    section: SettingsSaveSection | null,
    buildQueued: boolean,
    buildAttempted: boolean,
  ): string {
    const baseMessage = `${this.getSectionLabel(section)} salvas com sucesso.`;

    if (!buildAttempted) {
      return baseMessage;
    }

    return buildQueued
      ? `${baseMessage} Action de build acionada para atualizar o site.`
      : `${baseMessage} Nao foi possivel acionar a Action de build; acione o deploy manualmente.`;
  }

  private parseRecipients(value: string): string[] {
    return Array.from(
      new Set(
        value
          .split(/[\n,;]+/g)
          .map((email) => email.trim().toLowerCase())
          .filter((email) => email.length > 0),
      ),
    );
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

function phoneValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value?.trim();
  if (!value) {
    return null;
  }

  return /^[+()\d\s-]{8,40}$/.test(value) ? null : { phone: true };
}

function smtpHostValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value?.trim();
  if (!value) {
    return null;
  }

  if (/^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(value)) {
    return null;
  }

  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return value.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255)
      ? null
      : { host: true };
  }

  return { host: true };
}

function instagramValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value?.trim();
  if (!value) {
    return null;
  }

  if (/^@[a-zA-Z0-9._]{1,30}$/.test(value)) {
    return null;
  }

  return isHttpUrl(value) ? null : { url: true };
}

function formatBrazilianPhone(value: string): string {
  const trimmedValue = value.trim();
  const hasLeadingPlus = trimmedValue.startsWith('+');
  let digits = trimmedValue.replace(/\D/g, '').slice(0, 13);

  if (!digits) {
    return '';
  }

  if (hasLeadingPlus || digits.startsWith('55')) {
    if (!digits.startsWith('55')) {
      digits = `55${digits}`;
    }

    const country = digits.slice(0, 2);
    const area = digits.slice(2, 4);
    const number = digits.slice(4);
    return formatPhoneParts(`+${country}`, area, number);
  }

  const area = digits.slice(0, 2);
  const number = digits.slice(2);
  return formatPhoneParts('', area, number);
}

function formatPhoneParts(country: string, area: string, number: string): string {
  const prefix = [country, area ? `(${area}` : '']
    .filter((part) => part.length > 0)
    .join(' ');
  const closedArea = area.length === 2 ? prefix.replace(`(${area}`, `(${area})`) : prefix;

  if (!number) {
    return closedArea;
  }

  const splitIndex = number.length > 8 ? 5 : 4;
  const first = number.slice(0, splitIndex);
  const second = number.slice(splitIndex, splitIndex + 4);
  const formattedNumber = second ? `${first}-${second}` : first;

  return [closedArea, formattedNumber].filter((part) => part.length > 0).join(' ');
}

function normalizeInstagramValue(value: string): string {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return '';
  }

  if (normalizedValue.startsWith('@') || /^https?:\/\//i.test(normalizedValue)) {
    return normalizedValue;
  }

  if (/^(www\.)?instagram\.com\//i.test(normalizedValue)) {
    return `https://${normalizedValue}`;
  }

  return normalizedValue;
}

function normalizeUrlValue(value: string): string {
  const normalizedValue = value.trim();
  if (!normalizedValue || /^https?:\/\//i.test(normalizedValue)) {
    return normalizedValue;
  }

  if (/^(www\.)?[a-z0-9.-]+\.[a-z]{2,}/i.test(normalizedValue)) {
    return `https://${normalizedValue}`;
  }

  return normalizedValue;
}

function urlValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value?.trim();
  if (!value) {
    return null;
  }

  return isHttpUrl(value) ? null : { url: true };
}

function recipientsValidator(required: boolean) {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const value = control.value ?? '';
    const recipients = parseRecipientList(value);

    if (required && recipients.length === 0) {
      return { required: true };
    }

    const hasInvalidRecipient = recipients.some((email) => !isValidEmailAddress(email));
    return hasInvalidRecipient ? { emailList: true } : null;
  };
}

function parseRecipientList(value: string): string[] {
  return value
    .split(/[\n,;]+/g)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
