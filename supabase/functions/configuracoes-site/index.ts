import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { renderBrandEmail } from '../_shared/brand-email.ts'
import {
  encryptEmailSecret,
  sendTransactionalEmail,
  type EmailDeliveryConfig,
  type EmailProvider,
  type SmtpSecurity,
} from '../_shared/email-delivery.ts'

interface SiteSettingsRequest {
  emailAction?: 'test' | null
  articlesEnabled?: boolean | null
  contactPhoneWhatsapp?: string | null
  contactEmail?: string | null
  instagramUrl?: string | null
  linkedinUrl?: string | null
  passwordRecoverySenderEmail?: string | null
  userValidationSenderEmail?: string | null
  emailChangeSenderEmail?: string | null
  contactFormSenderEmail?: string | null
  contactConfirmationSenderEmail?: string | null
  contactNotificationSenderEmail?: string | null
  contactNotificationRecipients?: string[] | string | null
  contactNotificationCcRecipients?: string[] | string | null
  emailProvider?: EmailProvider | null
  emailFromName?: string | null
  emailFromAddress?: string | null
  emailReplyToEmail?: string | null
  emailSmtpHost?: string | null
  emailSmtpPort?: number | string | null
  emailSmtpSecurity?: SmtpSecurity | null
  emailSmtpUsername?: string | null
  emailSmtpPassword?: string | null
  emailTestRecipient?: string | null
}

interface JwtPayload {
  role?: unknown
  email?: unknown
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

const settingsSelect = [
  'id',
  'articles_enabled',
  'contact_phone_whatsapp',
  'contact_email',
  'instagram_url',
  'linkedin_url',
  'email_sender_name',
  'email_sender_address',
  'contact_confirmation_subject',
  'contact_confirmation_body',
  'password_recovery_sender_email',
  'user_validation_sender_email',
  'email_change_sender_email',
  'contact_confirmation_sender_email',
  'contact_notification_sender_email',
  'contact_notification_recipients',
  'contact_notification_cc_recipients',
  'contact_notification_subject',
  'email_provider',
  'email_from_name',
  'email_from_address',
  'email_reply_to',
  'email_smtp_host',
  'email_smtp_port',
  'email_smtp_security',
  'email_smtp_username',
  'email_smtp_password_secret',
  'email_last_test_at',
  'email_last_test_status',
  'email_last_test_error',
  'updated_at',
  'updated_by',
].join(',')

const defaultSettings = {
  id: 1,
  articles_enabled: true,
  contact_phone_whatsapp: '',
  contact_email: '',
  instagram_url: '',
  linkedin_url: '',
  email_sender_name: 'KW Advocacia',
  email_sender_address: 'washingtonlopes2003@gmail.com',
  contact_confirmation_subject: 'Recebemos seu contato',
  contact_confirmation_body: '',
  password_recovery_sender_email: 'washingtonlopes2003@gmail.com',
  user_validation_sender_email: 'washingtonlopes2003@gmail.com',
  email_change_sender_email: 'washingtonlopes2003@gmail.com',
  contact_confirmation_sender_email: 'washingtonlopes2003@gmail.com',
  contact_notification_sender_email: 'washingtonlopes2003@gmail.com',
  contact_notification_recipients: ['washingtonlopes2003@gmail.com'] as string[],
  contact_notification_cc_recipients: ['washingtonlopes2003@gmail.com'] as string[],
  contact_notification_subject: 'Novo contato recebido pelo site',
  email_provider: 'disabled',
  email_from_name: 'KW Advocacia',
  email_from_address: 'washingtonlopes2003@gmail.com',
  email_reply_to: '',
  email_smtp_host: '',
  email_smtp_port: 587,
  email_smtp_security: 'starttls',
  email_smtp_username: '',
  email_smtp_password_secret: '',
  email_last_test_status: '',
  email_last_test_error: '',
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authPayload = requireAuthenticatedRequest(req)
    const supabase = createAdminClient()

    if (req.method === 'GET') {
      const settings = await getOrCreateSettings(supabase)
      return jsonResponse({ data: mapSettings(settings) })
    }

    if (req.method === 'POST' || req.method === 'PATCH') {
      const body = await readRequestBody(req)
      const actorId = await resolveActorId(supabase, authPayload)
      const currentSettings = await getOrCreateSettings(supabase)
      const payload = await buildSettingsPayload(body, actorId, currentSettings)
      const settings = await saveSettings(supabase, payload)

      if (body.emailAction === 'test') {
        const testResult = await testEmailDelivery(supabase, settings, body)

        return jsonResponse({
          mensagem: testResult.sent
            ? 'Configuracoes salvas e e-mail de teste enviado.'
            : 'Configuracoes salvas, mas o e-mail de teste falhou.',
          data: mapSettings(testResult.settings),
          emailTest: {
            sent: testResult.sent,
            error: testResult.error,
          },
        })
      }

      return jsonResponse({
        mensagem: 'Configuracoes salvas com sucesso.',
        data: mapSettings(settings),
      })
    }

    return jsonResponse({ message: 'Metodo nao permitido.' }, 405)
  } catch (error) {
    const message = extractErrorMessage(error)
    const status = error instanceof RequestError ? error.status : extractErrorStatus(error) ?? 400

    return jsonResponse({ error: message, erro: message, message }, status)
  }
})

function createAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new RequestError('Variaveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorias.', 500)
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function getOrCreateSettings(supabase: SupabaseClient): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from('site_settings')
    .select(settingsSelect)
    .eq('id', 1)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (data) {
    return data as unknown as Record<string, unknown>
  }

  const { data: inserted, error: insertError } = await supabase
    .from('site_settings')
    .insert(defaultSettings)
    .select(settingsSelect)
    .single()

  if (insertError) {
    throw insertError
  }

  if (!inserted) {
    throw new RequestError('Nao foi possivel criar as configuracoes iniciais.', 500)
  }

  return inserted as unknown as Record<string, unknown>
}

async function saveSettings(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from('site_settings')
    .update(payload)
    .eq('id', 1)
    .select(settingsSelect)
    .single()

  if (error) {
    throw error
  }

  if (!data) {
    throw new RequestError('A tabela site_settings nao retornou as configuracoes salvas.', 500)
  }

  return data as unknown as Record<string, unknown>
}

async function testEmailDelivery(
  supabase: SupabaseClient,
  settings: Record<string, unknown>,
  body: SiteSettingsRequest,
): Promise<{ settings: Record<string, unknown>; sent: boolean; error: string | null }> {
  const config = buildEmailDeliveryConfig(settings)
  const recipient =
    normalizeOptionalEmail(body.emailTestRecipient, 'Destinatario de teste invalido.') ??
    normalizeEmail(settings['contact_email']) ??
    normalizeEmail(settings['email_from_address']) ??
    normalizeEmail(settings['contact_notification_sender_email'])

  if (!recipient) {
    throw new RequestError('Informe um destinatario valido para o teste de e-mail.')
  }

  const result = await sendTransactionalEmail({
    fromEmail: config.fromEmail ?? 'washingtonlopes2003@gmail.com',
    fromName: config.fromName ?? 'KW Advocacia',
    to: [recipient],
    cc: [],
    replyTo: config.replyToEmail,
    subject: 'Teste de envio - KW Advocacia',
    html: renderEmailTestHtml(),
  }, config)

  const { data, error } = await supabase
    .from('site_settings')
    .update({
      email_last_test_at: new Date().toISOString(),
      email_last_test_status: result.sent ? 'success' : 'error',
      email_last_test_error: result.error ?? '',
    })
    .eq('id', 1)
    .select(settingsSelect)
    .single()

  if (error) {
    throw error
  }

  return {
    settings: data ? data as unknown as Record<string, unknown> : settings,
    sent: result.sent,
    error: result.error,
  }
}

function buildEmailDeliveryConfig(row: Record<string, unknown>): EmailDeliveryConfig {
  return {
    provider: normalizeEmailProvider(row['email_provider']),
    fromName: normalizeText(row['email_from_name']) ??
      normalizeText(row['email_sender_name']) ??
      'KW Advocacia',
    fromEmail: normalizeEmail(row['email_from_address']) ??
      normalizeEmail(row['contact_notification_sender_email']) ??
      normalizeEmail(row['email_sender_address']) ??
      'washingtonlopes2003@gmail.com',
    replyToEmail: normalizeEmail(row['email_reply_to']),
    smtpHost: normalizeText(row['email_smtp_host']) ?? '',
    smtpPort: normalizeSmtpPortOrDefault(row['email_smtp_port']),
    smtpSecurity: normalizeSmtpSecurity(row['email_smtp_security']),
    smtpUsername: normalizeText(row['email_smtp_username']) ?? '',
    smtpPasswordSecret: normalizeText(row['email_smtp_password_secret']) ?? '',
  }
}

function normalizeSmtpPortOrDefault(value: unknown): number {
  try {
    return normalizeSmtpPort(value)
  } catch {
    return 587
  }
}

function renderEmailTestHtml(): string {
  return renderBrandEmail({
    title: 'Teste de envio',
    paragraphs: [
      'Se voce recebeu este e-mail, o provedor de envio do CMS foi configurado corretamente.',
    ],
  })
}

async function buildSettingsPayload(
  body: SiteSettingsRequest,
  actorId: number | null,
  currentSettings: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  }
  const globalSenderFallback = resolveRequestedGlobalSender(body, currentSettings)

  if (hasOwnProperty(body, 'articlesEnabled')) {
    payload['articles_enabled'] = body.articlesEnabled !== false
  }

  if (hasOwnProperty(body, 'contactPhoneWhatsapp')) {
    payload['contact_phone_whatsapp'] = normalizeBoundedText(body.contactPhoneWhatsapp, 40)
  }

  if (hasOwnProperty(body, 'contactEmail')) {
    payload['contact_email'] = normalizeOptionalEmail(body.contactEmail, 'E-mail de contato invalido.') ?? ''
  }

  if (hasOwnProperty(body, 'instagramUrl')) {
    payload['instagram_url'] = normalizeSocialAddress(body.instagramUrl, 'instagram')
  }

  if (hasOwnProperty(body, 'linkedinUrl')) {
    payload['linkedin_url'] = normalizeSocialAddress(body.linkedinUrl, 'linkedin')
  }

  if (hasOwnProperty(body, 'passwordRecoverySenderEmail')) {
    payload['password_recovery_sender_email'] = requireEmailWithFallback(
      body.passwordRecoverySenderEmail,
      globalSenderFallback,
      'E-mail de envio de recuperacao invalido.',
    )
  }

  if (hasOwnProperty(body, 'userValidationSenderEmail')) {
    payload['user_validation_sender_email'] = requireEmailWithFallback(
      body.userValidationSenderEmail,
      globalSenderFallback,
      'E-mail de envio de validacao de usuario invalido.',
    )
  }

  if (hasOwnProperty(body, 'emailChangeSenderEmail')) {
    payload['email_change_sender_email'] = requireEmailWithFallback(
      body.emailChangeSenderEmail,
      globalSenderFallback,
      'E-mail de envio de alteracao de e-mail invalido.',
    )
  }

  if (hasOwnProperty(body, 'contactFormSenderEmail')) {
    const contactFormSenderEmail = requireEmailWithFallback(
      body.contactFormSenderEmail,
      globalSenderFallback,
      'E-mail de envio de contato invalido.',
    )

    payload['contact_confirmation_sender_email'] = contactFormSenderEmail
    payload['contact_notification_sender_email'] = contactFormSenderEmail
  }

  if (hasOwnProperty(body, 'contactConfirmationSenderEmail')) {
    payload['contact_confirmation_sender_email'] = requireEmailWithFallback(
      body.contactConfirmationSenderEmail,
      globalSenderFallback,
      'E-mail de confirmacao de contato invalido.',
    )
  }

  if (hasOwnProperty(body, 'contactNotificationSenderEmail')) {
    const contactNotificationSenderEmail = requireEmailWithFallback(
      body.contactNotificationSenderEmail,
      globalSenderFallback,
      'E-mail de envio de contato invalido.',
    )

    payload['contact_notification_sender_email'] = contactNotificationSenderEmail
  }

  if (hasOwnProperty(body, 'contactNotificationRecipients')) {
    payload['contact_notification_recipients'] = normalizeRecipients(
      body.contactNotificationRecipients,
      ['washingtonlopes2003@gmail.com'],
      true,
    )
  }

  if (hasOwnProperty(body, 'contactNotificationCcRecipients')) {
    payload['contact_notification_cc_recipients'] = normalizeRecipients(
      body.contactNotificationCcRecipients,
      [],
      false,
    )
  }

  if (hasOwnProperty(body, 'emailProvider')) {
    const provider = normalizeEmailProvider(body.emailProvider)
    payload['email_provider'] = provider

    if (provider === 'disabled') {
      payload['email_last_test_status'] = ''
      payload['email_last_test_error'] = ''
      payload['email_last_test_at'] = null
    }
  }

  if (hasOwnProperty(body, 'emailFromName')) {
    payload['email_from_name'] = normalizeBoundedText(body.emailFromName, 120, 'KW Advocacia')
    payload['email_sender_name'] = payload['email_from_name']
  }

  if (hasOwnProperty(body, 'emailFromAddress')) {
    const fromEmail = requireRequiredEmail(
      body.emailFromAddress,
      'E-mail de envio invalido.',
    )

    payload['email_from_address'] = fromEmail
    payload['email_sender_address'] = fromEmail
  }

  if (hasOwnProperty(body, 'emailReplyToEmail')) {
    payload['email_reply_to'] = normalizeOptionalEmail(
      body.emailReplyToEmail,
      'E-mail de resposta invalido.',
    ) ?? ''
  }

  if (hasOwnProperty(body, 'emailSmtpHost')) {
    payload['email_smtp_host'] = normalizeBoundedText(body.emailSmtpHost, 180)
  }

  if (hasOwnProperty(body, 'emailSmtpPort')) {
    payload['email_smtp_port'] = normalizeSmtpPort(body.emailSmtpPort)
  }

  if (hasOwnProperty(body, 'emailSmtpSecurity')) {
    payload['email_smtp_security'] = normalizeSmtpSecurity(body.emailSmtpSecurity)
  }

  if (hasOwnProperty(body, 'emailSmtpUsername')) {
    payload['email_smtp_username'] = normalizeBoundedText(body.emailSmtpUsername, 180)
  }

  if (hasOwnProperty(body, 'emailSmtpPassword')) {
    const password = normalizeText(body.emailSmtpPassword)
    if (password) {
      payload['email_smtp_password_secret'] = await encryptEmailSecret(password)
    }
  }

  applyProviderSenderPolicy(payload, currentSettings)

  return payload
}

function applyProviderSenderPolicy(
  payload: Record<string, unknown>,
  currentSettings: Record<string, unknown>,
): void {
  const provider = normalizeEmailProvider(payload['email_provider'] ?? currentSettings['email_provider'])

  if (usesFeatureSenderAliases(provider)) {
    return
  }

  const globalSender =
    normalizeEmail(payload['email_from_address']) ??
    normalizeEmail(currentSettings['email_from_address']) ??
    normalizeEmail(currentSettings['email_sender_address']) ??
    'washingtonlopes2003@gmail.com'

  payload['password_recovery_sender_email'] = globalSender
  payload['user_validation_sender_email'] = globalSender
  payload['email_change_sender_email'] = globalSender
  payload['contact_confirmation_sender_email'] = globalSender
  payload['contact_notification_sender_email'] = globalSender

  if (provider === 'gmail' || provider === 'microsoft') {
    payload['email_smtp_username'] = globalSender
  }
}

function usesFeatureSenderAliases(provider: EmailProvider): boolean {
  return provider === 'smtp' || provider === 'resend'
}

function hasOwnProperty(object: SiteSettingsRequest, key: keyof SiteSettingsRequest): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function resolveRequestedGlobalSender(
  body: SiteSettingsRequest,
  currentSettings: Record<string, unknown>,
): string {
  const requestedSender = hasOwnProperty(body, 'emailFromAddress')
    ? normalizeEmail(body.emailFromAddress)
    : null

  return requestedSender ??
    normalizeEmail(currentSettings['email_from_address']) ??
    normalizeEmail(currentSettings['email_sender_address']) ??
    'washingtonlopes2003@gmail.com'
}

function requireRequiredEmail(value: unknown, errorMessage: string): string {
  const email = normalizeEmail(value)

  if (!email) {
    throw new RequestError(errorMessage)
  }

  return email
}

function requireEmailWithFallback(value: unknown, fallback: string, errorMessage: string): string {
  const text = normalizeText(value) ?? fallback

  if (!isValidEmail(text)) {
    throw new RequestError(errorMessage)
  }

  return text.toLowerCase()
}

function normalizeOptionalEmail(value: unknown, errorMessage: string): string | null {
  const text = normalizeText(value)

  if (!text) {
    return null
  }

  if (!isValidEmail(text)) {
    throw new RequestError(errorMessage)
  }

  return text.toLowerCase()
}

function normalizeRecipients(value: unknown, fallback: string[] = [], required = false): string[] {
  const rawRecipients = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,;]+/g)
      : fallback

  const recipients = Array.from(
    new Set(
      rawRecipients
        .map((recipient) => normalizeText(recipient))
        .filter((recipient): recipient is string => Boolean(recipient))
        .map((recipient) => recipient.toLowerCase()),
    ),
  )

  const invalidRecipient = recipients.find((recipient) => !isValidEmail(recipient))
  if (invalidRecipient) {
    throw new RequestError(`E-mail de notificacao invalido: ${invalidRecipient}`)
  }

  if (required && recipients.length === 0) {
    throw new RequestError('Informe pelo menos um destinatario para notificacoes de contato.')
  }

  return recipients
}

function normalizeEmailProvider(value: unknown): EmailProvider {
  const provider = normalizeText(value)?.toLowerCase()

  if (
    provider === 'disabled' ||
    provider === 'gmail' ||
    provider === 'microsoft' ||
    provider === 'smtp' ||
    provider === 'resend'
  ) {
    return provider
  }

  return 'disabled'
}

function normalizeSmtpSecurity(value: unknown): SmtpSecurity {
  const security = normalizeText(value)?.toLowerCase()

  if (security === 'ssl' || security === 'starttls' || security === 'none') {
    return security
  }

  return 'starttls'
}

function normalizeSmtpPort(value: unknown): number {
  const port = typeof value === 'number' ? value : Number(value)

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new RequestError('Porta SMTP invalida.')
  }

  return port
}

function normalizeSocialAddress(value: unknown, provider: 'instagram' | 'linkedin'): string {
  const text = normalizeText(value)

  if (!text) {
    return ''
  }

  if (text.startsWith('@') && provider === 'instagram') {
    return `https://instagram.com/${encodeURIComponent(text.slice(1))}`
  }

  if (!/^https?:\/\//i.test(text)) {
    throw new RequestError(`${provider === 'instagram' ? 'Instagram' : 'Linkedin'} precisa ser uma URL valida.`)
  }

  try {
    const url = new URL(text)
    return url.toString()
  } catch {
    throw new RequestError(`${provider === 'instagram' ? 'Instagram' : 'Linkedin'} precisa ser uma URL valida.`)
  }
}

function normalizeBoundedText(value: unknown, maxLength: number, fallback = ''): string {
  const text = normalizeText(value) ?? fallback

  if (text.length > maxLength) {
    throw new RequestError(`Campo com limite de ${maxLength} caracteres excedido.`)
  }

  return text
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

async function resolveActorId(supabase: SupabaseClient, payload: JwtPayload): Promise<number | null> {
  const email = normalizeEmail(payload.email)
  if (!email) {
    return null
  }

  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (error) {
    return null
  }

  return parsePositiveInteger(data?.id)
}

async function readRequestBody(req: Request): Promise<SiteSettingsRequest> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body as SiteSettingsRequest : {}
  } catch {
    throw new RequestError('JSON invalido na requisicao.')
  }
}

function requireAuthenticatedRequest(req: Request): JwtPayload {
  const payload = decodeJwtPayload(req.headers.get('authorization'))
  const role = normalizeText(payload?.role)

  if (role !== 'authenticated') {
    throw new RequestError('Sessao autenticada obrigatoria para gerenciar configuracoes.', 401)
  }

  return payload ?? {}
}

function decodeJwtPayload(authorizationHeader: string | null): JwtPayload | null {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, '').trim() ?? ''
  const [, payload] = token.split('.')

  if (!payload) {
    return null
  }

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    return JSON.parse(atob(paddedBase64)) as JwtPayload
  } catch {
    return null
  }
}

function mapSettings(row: Record<string, unknown>): Record<string, unknown> {
  const provider = normalizeEmailProvider(row['email_provider'])
  const globalSender =
    normalizeEmail(row['email_from_address']) ??
    normalizeEmail(row['email_sender_address']) ??
    'washingtonlopes2003@gmail.com'
  const useAliases = usesFeatureSenderAliases(provider)

  return {
    articlesEnabled: row['articles_enabled'] !== false,
    contactPhoneWhatsapp: normalizeText(row['contact_phone_whatsapp']) ?? '',
    contactEmail: normalizeText(row['contact_email']) ?? '',
    instagramUrl: normalizeText(row['instagram_url']) ?? '',
    linkedinUrl: normalizeText(row['linkedin_url']) ?? '',
    passwordRecoverySenderEmail: useAliases
      ? normalizeEmail(row['password_recovery_sender_email']) ?? globalSender
      : globalSender,
    userValidationSenderEmail: useAliases
      ? normalizeEmail(row['user_validation_sender_email']) ?? globalSender
      : globalSender,
    emailChangeSenderEmail: useAliases
      ? normalizeEmail(row['email_change_sender_email']) ?? globalSender
      : globalSender,
    contactFormSenderEmail: useAliases
      ? normalizeEmail(row['contact_notification_sender_email']) ??
        normalizeEmail(row['contact_confirmation_sender_email']) ??
        globalSender
      : globalSender,
    contactConfirmationSenderEmail: useAliases
      ? normalizeEmail(row['contact_confirmation_sender_email']) ?? globalSender
      : globalSender,
    contactNotificationSenderEmail: useAliases
      ? normalizeEmail(row['contact_notification_sender_email']) ?? globalSender
      : globalSender,
    contactNotificationRecipients: Array.isArray(row['contact_notification_recipients'])
      ? row['contact_notification_recipients']
      : ['washingtonlopes2003@gmail.com'],
    contactNotificationCcRecipients: Array.isArray(row['contact_notification_cc_recipients'])
      ? row['contact_notification_cc_recipients']
      : ['washingtonlopes2003@gmail.com'],
    emailProvider: provider,
    emailFromName: normalizeText(row['email_from_name']) ??
      normalizeText(row['email_sender_name']) ??
      'KW Advocacia',
    emailFromAddress: normalizeEmail(row['email_from_address']) ??
      normalizeEmail(row['contact_notification_sender_email']) ??
      normalizeEmail(row['email_sender_address']) ??
      'washingtonlopes2003@gmail.com',
    emailReplyToEmail: normalizeEmail(row['email_reply_to']) ?? '',
    emailSmtpHost: normalizeText(row['email_smtp_host']) ?? '',
    emailSmtpPort: normalizeSmtpPortOrDefault(row['email_smtp_port']),
    emailSmtpSecurity: normalizeSmtpSecurity(row['email_smtp_security']),
    emailSmtpUsername: normalizeText(row['email_smtp_username']) ?? '',
    emailSmtpPasswordConfigured: Boolean(normalizeText(row['email_smtp_password_secret'])),
    emailLastTestAt: normalizeText(row['email_last_test_at']),
    emailLastTestStatus: normalizeText(row['email_last_test_status']) ?? '',
    emailLastTestError: normalizeText(row['email_last_test_error']) ?? '',
    updatedAt: normalizeText(row['updated_at']),
    updatedBy: parsePositiveInteger(row['updated_by']),
  }
}

function normalizeEmail(value: unknown): string | null {
  const text = normalizeText(value)
  return text && isValidEmail(text) ? text.toLowerCase() : null
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized || null
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  return null
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>

    return [
      record['message'],
      record['error_description'],
      record['error'],
      record['msg'],
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ') || 'Nao foi possivel salvar as configuracoes.'
  }

  return 'Nao foi possivel salvar as configuracoes.'
}

function extractErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const status = (error as Record<string, unknown>)['status']
  return typeof status === 'number' ? status : null
}
