import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { Settings } from './settings';
import { SettingsService, SiteSettings, SiteSettingsPayload } from '../../core/settings.service';

class FakeSettingsService {
  settings = buildSettings();
  testResult: { sent: boolean; error: string | null } = { sent: true, error: null };
  lastTestPayload: SiteSettingsPayload | null = null;
  lastSavePayload: SiteSettingsPayload | null = null;

  getSettings = jasmine.createSpy('getSettings').and.callFake(() => of(this.settings));

  saveSettings = jasmine.createSpy('saveSettings').and.callFake((payload: SiteSettingsPayload) => {
    this.lastSavePayload = payload;
    this.settings = { ...this.settings, ...payload } as SiteSettings;
    return of(this.settings);
  });

  testEmailSettings = jasmine.createSpy('testEmailSettings').and.callFake((payload: SiteSettingsPayload) => {
    this.lastTestPayload = payload;
    this.settings = { ...this.settings, ...payload } as SiteSettings;
    return of({
      settings: this.settings,
      sent: this.testResult.sent,
      error: this.testResult.error,
    });
  });
}

describe('Settings e-mail configuration', () => {
  let fixture: ComponentFixture<Settings>;
  let component: Settings;
  let settingsService: FakeSettingsService;

  beforeEach(async () => {
    settingsService = new FakeSettingsService();

    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts the e-mail configuration closed and keeps the saved provider in the header', () => {
    expect(component.isEmailConfigOpen).toBeFalse();
    expect(component.activeProviderStatusLabel).toBe('Gmail ativo');

    component.selectEmailProvider('smtp');

    expect(component.selectedEmailProvider).toBe('smtp');
    expect(component.activeProviderStatusLabel).toBe('Gmail ativo');
    expect(fixture.nativeElement.querySelector('#smtp-password')).toBeNull();
  });

  it('keeps Gmail in simple mode without alias fields', () => {
    renderWithSettings(buildSettings(), true);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Senha de app');
    expect(text).toContain('Teste de envio');
    expect(fixture.nativeElement.querySelector('#smtp-host')).toBeNull();
    expect(fixture.nativeElement.querySelector('#password-recovery-email')).toBeNull();
    expect(fixture.nativeElement.querySelector('#notification-recipients')).toBeNull();
  });

  it('keeps advanced configuration closed when SMTP is selected', () => {
    renderWithSettings({
      ...buildSettings(),
      emailProvider: 'smtp',
      emailSmtpHost: 'smtp.example.com',
      emailSmtpUsername: 'global@example.com',
    }, true);

    expect(component.openEmailAliasFlow).toBeNull();
    expect(component.usesCustomSmtp).toBeTrue();
    expect(fixture.nativeElement.querySelector('#smtp-host')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#password-recovery-email')).toBeNull();
  });

  it('falls back empty SMTP aliases to the global sender on save payload', () => {
    component.selectEmailProvider('smtp');
    component.form.patchValue({
      emailFromAddress: 'global@example.com',
      emailSmtpHost: 'smtp.example.com',
      emailSmtpUsername: 'global@example.com',
      passwordRecoverySenderEmail: '',
      userValidationSenderEmail: '',
      emailChangeSenderEmail: '',
      contactFormSenderEmail: '',
      contactNotificationRecipients: 'admin@example.com',
      emailTestRecipient: 'tester@example.com',
    });

    component.requestSave('email');
    component.confirmSave();

    expect(settingsService.saveSettings).toHaveBeenCalled();
    expect(settingsService.lastSavePayload?.passwordRecoverySenderEmail).toBe('global@example.com');
    expect(settingsService.lastSavePayload?.userValidationSenderEmail).toBe('global@example.com');
    expect(settingsService.lastSavePayload?.emailChangeSenderEmail).toBe('global@example.com');
    expect(settingsService.lastSavePayload?.contactFormSenderEmail).toBe('global@example.com');
    expect(settingsService.lastSavePayload?.contactConfirmationSenderEmail).toBe('global@example.com');
    expect(settingsService.lastSavePayload?.contactNotificationSenderEmail).toBe('global@example.com');
  });

  it('requires an app password for Gmail when no password is already configured', () => {
    settingsService.settings = {
      ...buildSettings(),
      emailProvider: 'gmail',
      emailSmtpPasswordConfigured: false,
    };
    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.requestSave('email');

    expect(settingsService.saveSettings).not.toHaveBeenCalled();
    expect(component.errorMessage).toContain('senha de app');
  });

  it('shows SMTP test errors next to the test action', () => {
    settingsService.testResult = {
      sent: false,
      error: 'Falha ao enviar e-mail por SMTP: 535 Username and Password not accepted.',
    };

    component.testEmailSettings();

    expect(component.emailTestErrorMessage).toContain('Falha na autenticação do Gmail');
    expect(component.emailTestErrorMessage).toContain('senha de app');
  });

  it('does not render authentication fields when e-mail sending is disabled', () => {
    renderWithSettings({
      ...buildSettings(),
      emailProvider: 'disabled',
    }, true);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Nenhum e-mail transacional');
    expect(fixture.nativeElement.querySelector('#email-from-address')).toBeNull();
    expect(fixture.nativeElement.querySelector('#smtp-password')).toBeNull();
    expect(fixture.nativeElement.querySelector('#email-test-recipient')).toBeNull();

    component.testEmailSettings();

    expect(settingsService.testEmailSettings).not.toHaveBeenCalled();
    expect(component.emailTestErrorMessage).toContain('Ative um metodo de envio');
  });

  function renderWithSettings(settings: SiteSettings, openEmail = false): void {
    settingsService.settings = settings;
    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    component.isEmailConfigOpen = openEmail;
    fixture.detectChanges();
  }
});

function buildSettings(): SiteSettings {
  return {
    articlesEnabled: true,
    contactPhoneWhatsapp: '+55 11 99999-9999',
    contactEmail: 'contato@example.com',
    instagramUrl: '',
    linkedinUrl: '',
    passwordRecoverySenderEmail: 'global@example.com',
    userValidationSenderEmail: 'global@example.com',
    emailChangeSenderEmail: 'global@example.com',
    contactFormSenderEmail: 'global@example.com',
    contactConfirmationSenderEmail: 'global@example.com',
    contactNotificationSenderEmail: 'global@example.com',
    contactNotificationRecipients: ['admin@example.com'],
    contactNotificationCcRecipients: [],
    emailProvider: 'gmail',
    emailFromName: 'KW Advocacia',
    emailFromAddress: 'global@example.com',
    emailReplyToEmail: 'responder@example.com',
    emailSmtpHost: 'smtp.gmail.com',
    emailSmtpPort: 587,
    emailSmtpSecurity: 'starttls',
    emailSmtpUsername: 'global@example.com',
    emailSmtpPasswordConfigured: true,
    emailLastTestAt: null,
    emailLastTestStatus: '',
    emailLastTestError: '',
    updatedAt: null,
    updatedBy: null,
  };
}
