import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sendTransactionalEmail, type EmailDeliveryConfig, type EmailProvider, type SmtpSecurity } from '../_shared/email-delivery.ts'

type MessageStatus = 'unread' | 'read' | 'archived'

interface ContactMessageRequest {
  id?: number | string | null
  name?: string | null
  email?: string | null
  phone?: string | null
  message?: string | null
  status?: MessageStatus | null
  lgpdAccepted?: boolean | null
}

interface SiteSettingsRow {
  contact_email?: string | null
  email_sender_name?: string | null
  email_sender_address?: string | null
  contact_notification_sender_email?: string | null
  contact_confirmation_sender_email?: string | null
  contact_confirmation_subject?: string | null
  contact_confirmation_body?: string | null
  contact_notification_recipients?: string[] | null
  contact_notification_cc_recipients?: string[] | null
  contact_notification_subject?: string | null
  email_provider?: EmailProvider | null
  email_from_name?: string | null
  email_from_address?: string | null
  email_reply_to?: string | null
  email_smtp_host?: string | null
  email_smtp_port?: number | null
  email_smtp_security?: SmtpSecurity | null
  email_smtp_username?: string | null
  email_smtp_password_secret?: string | null
}

interface ContactMessageRow {
  id?: number | null
  name?: string | null
  email?: string | null
  phone?: string | null
  message?: string | null
  status?: MessageStatus | null
  email_confirmation_sent?: boolean | null
  email_notification_sent?: boolean | null
  email_delivery_error?: string | null
  confirmation_sender_email?: string | null
  confirmation_recipient_email?: string | null
  notification_sender_email?: string | null
  notification_recipient_emails?: string[] | null
  notification_cc_emails?: string[] | null
  created_at?: string | null
  read_at?: string | null
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

const messageSelect = [
  'id',
  'name',
  'email',
  'phone',
  'message',
  'status',
  'email_confirmation_sent',
  'email_notification_sent',
  'email_delivery_error',
  'confirmation_sender_email',
  'confirmation_recipient_email',
  'notification_sender_email',
  'notification_recipient_emails',
  'notification_cc_emails',
  'created_at',
  'read_at',
].join(',')

const settingsSelect = [
  'contact_email',
  'email_sender_name',
  'email_sender_address',
  'contact_notification_sender_email',
  'contact_confirmation_sender_email',
  'contact_confirmation_subject',
  'contact_confirmation_body',
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
].join(',')

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
    const supabase = createAdminClient()

    if (req.method === 'POST') {
      const body = await readRequestBody(req)
      return await createContactMessage(supabase, body)
    }

    if (req.method === 'GET') {
      await requireAuthenticatedRequest(req)
      return await listContactMessages(supabase)
    }

    if (req.method === 'PATCH') {
      await requireAuthenticatedRequest(req)
      const body = await readRequestBody(req)
      return await updateContactMessageStatus(supabase, body)
    }

    return jsonResponse({ message: 'Metodo nao permitido.' }, 405)
  } catch (error) {
    const message = extractErrorMessage(error)
    const status = error instanceof RequestError ? error.status : extractErrorStatus(error) ?? 400

    return jsonResponse({ error: message, erro: message, message }, status)
  }
})

async function createContactMessage(
  supabase: SupabaseClient,
  body: ContactMessageRequest,
): Promise<Response> {
  const settings = await getSiteSettings(supabase)
  const emailRouting = buildEmailRouting(settings, body)
  const payload = buildContactMessagePayload(body, emailRouting)
  const { data, error } = await supabase
    .from('contact_messages')
    .insert(payload)
    .select(messageSelect)
    .single()

  if (error) {
    throw error
  }

  if (!data) {
    throw new RequestError('Nao foi possivel registrar a mensagem.', 500)
  }

  const message = data as ContactMessageRow
  const delivery = await deliverContactEmails(settings, message)
  const emailDeliveryError = [delivery.confirmationError, delivery.notificationError]
    .filter((value): value is string => Boolean(value))
    .join(' | ')

  const { data: updatedMessage, error: updateError } = await supabase
    .from('contact_messages')
    .update({
      email_confirmation_sent: delivery.confirmationSent,
      email_notification_sent: delivery.notificationSent,
      email_delivery_error: emailDeliveryError || null,
    })
    .eq('id', message.id)
    .select(messageSelect)
    .single()

  if (updateError) {
    throw updateError
  }

  return jsonResponse({
    mensagem: 'Mensagem enviada com sucesso.',
    data: mapContactMessage(updatedMessage ? updatedMessage as ContactMessageRow : message),
  })
}

async function listContactMessages(supabase: SupabaseClient): Promise<Response> {
  const { data, error } = await supabase
    .from('contact_messages')
    .select(messageSelect)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    throw error
  }

  return jsonResponse({
    data: {
      messages: ((data ?? []) as ContactMessageRow[]).map((message) => mapContactMessage(message)),
    },
  })
}

async function updateContactMessageStatus(
  supabase: SupabaseClient,
  body: ContactMessageRequest,
): Promise<Response> {
  const messageId = parsePositiveInteger(body.id)
  const status = normalizeMessageStatus(body.status)

  if (messageId === null) {
    throw new RequestError('Mensagem nao encontrada.', 404)
  }

  const { data, error } = await supabase
    .from('contact_messages')
    .update({
      status,
      read_at: status === 'read' ? new Date().toISOString() : null,
    })
    .eq('id', messageId)
    .select(messageSelect)
    .single()

  if (error) {
    throw error
  }

  return jsonResponse({
    mensagem: 'Mensagem atualizada com sucesso.',
    data: {
      message: mapContactMessage(data as ContactMessageRow | null),
    },
  })
}

function buildContactMessagePayload(
  body: ContactMessageRequest,
  emailRouting: {
    confirmationSenderEmail: string
    confirmationRecipientEmail: string
    notificationSenderEmail: string
    notificationRecipients: string[]
    notificationCcRecipients: string[]
  },
): Record<string, unknown> {
  if (body.lgpdAccepted !== true) {
    throw new RequestError('Confirme a politica de privacidade para enviar a mensagem.')
  }

  return {
    name: requireBoundedText(body.name, 'Informe seu nome.', 160),
    email: requireEmail(body.email),
    phone: requirePhone(body.phone),
    message: requireBoundedText(body.message, 'Informe a mensagem.', 4000),
    status: 'unread',
    confirmation_sender_email: emailRouting.confirmationSenderEmail,
    confirmation_recipient_email: emailRouting.confirmationRecipientEmail,
    notification_sender_email: emailRouting.notificationSenderEmail,
    notification_recipient_emails: emailRouting.notificationRecipients,
    notification_cc_emails: emailRouting.notificationCcRecipients,
    created_at: new Date().toISOString(),
  }
}

async function getSiteSettings(supabase: SupabaseClient): Promise<SiteSettingsRow> {
  const { data, error } = await supabase
    .from('site_settings')
    .select(settingsSelect)
    .eq('id', 1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data ? data as SiteSettingsRow : {}
}

async function deliverContactEmails(
  settings: SiteSettingsRow,
  message: ContactMessageRow,
): Promise<{
  confirmationSent: boolean
  notificationSent: boolean
  confirmationError: string | null
  notificationError: string | null
}> {
  const emailConfig = buildEmailDeliveryConfig(settings)
  const fallbackRouting = buildEmailRouting(settings, { email: message.email, lgpdAccepted: true })
  const senderEmail =
    normalizeEmail(message.notification_sender_email) ??
    fallbackRouting.notificationSenderEmail
  const senderName = normalizeText(emailConfig.fromName) ?? normalizeText(settings.email_sender_name) ?? 'KW Advocacia'
  const notificationRecipients = normalizeRecipients(message.notification_recipient_emails).length > 0
    ? normalizeRecipients(message.notification_recipient_emails)
    : fallbackRouting.notificationRecipients
  const notificationCcRecipients = normalizeRecipients(message.notification_cc_emails).length > 0
    ? normalizeRecipients(message.notification_cc_emails)
    : fallbackRouting.notificationCcRecipients

  const confirmation = await sendEmail({
    fromEmail: normalizeEmail(message.confirmation_sender_email) ?? fallbackRouting.confirmationSenderEmail,
    fromName: senderName,
    to: [requireEmail(message.confirmation_recipient_email ?? message.email)],
    cc: [],
    subject: normalizeText(settings.contact_confirmation_subject) ?? 'Recebemos seu contato',
    html: renderConfirmationEmail(message),
  }, emailConfig)

  const notification = await sendEmail({
    fromEmail: senderEmail,
    fromName: senderName,
    to: notificationRecipients,
    cc: notificationCcRecipients,
    replyTo: normalizeEmail(message.email),
    subject: normalizeText(settings.contact_notification_subject) ?? 'Novo contato recebido pelo site',
    html: renderNotificationEmail(message),
  }, emailConfig)

  return {
    confirmationSent: confirmation.sent,
    notificationSent: notification.sent,
    confirmationError: confirmation.error,
    notificationError: notification.error,
  }
}

async function sendEmail(options: {
  fromEmail: string | null
  fromName: string
  to: string[]
  cc: string[]
  replyTo?: string | null
  subject: string
  html: string
}, config: EmailDeliveryConfig): Promise<{ sent: boolean; error: string | null }> {
  return await sendTransactionalEmail(options, config)
}

function renderConfirmationEmail(message: ContactMessageRow): string {
  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#1f2937">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px">
        <h1 style="margin:0 0 14px;color:#273F4B;font-size:22px">Recebemos seu contato</h1>
        <p style="margin:0 0 12px;line-height:1.6">Ola, ${escapeHtml(normalizeText(message.name) ?? 'tudo bem')}.</p>
        <p style="margin:0 0 12px;line-height:1.6">Sua mensagem foi registrada e sera analisada pela equipe juridica.</p>
        <p style="margin:0;line-height:1.6;color:#475569">Em breve retornaremos pelo e-mail ou telefone informado.</p>
      </div>
    </div>
  `
}

function renderNotificationEmail(message: ContactMessageRow): string {
  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#1f2937">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px">
        <h1 style="margin:0 0 14px;color:#273F4B;font-size:22px">Novo contato recebido</h1>
        <p style="margin:0 0 16px;color:#475569">Uma nova mensagem foi enviada pelo site.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px">
          <p style="margin:0 0 8px"><strong>Nome:</strong> ${escapeHtml(normalizeText(message.name) ?? '')}</p>
          <p style="margin:0 0 8px"><strong>E-mail:</strong> ${escapeHtml(normalizeText(message.email) ?? '')}</p>
          <p style="margin:0"><strong>Telefone:</strong> ${escapeHtml(normalizeText(message.phone) ?? '')}</p>
        </div>
        <p style="margin:0 0 8px"><strong>Mensagem:</strong></p>
        <p style="margin:0;line-height:1.6">${escapeHtml(normalizeText(message.message) ?? '').replace(/\n/g, '<br>')}</p>
      </div>
    </div>
  `
}

function buildEmailRouting(
  settings: SiteSettingsRow,
  body: Pick<ContactMessageRequest, 'email' | 'lgpdAccepted'>,
): {
  confirmationSenderEmail: string
  confirmationRecipientEmail: string
  notificationSenderEmail: string
  notificationRecipients: string[]
  notificationCcRecipients: string[]
} {
  const contactSenderEmail = resolveContactSenderEmail(settings)
  const notificationRecipients = normalizeRecipients(settings.contact_notification_recipients)
  const fallbackRecipient = normalizeEmail(settings.contact_email)
  const notificationCcRecipients = normalizeRecipients(settings.contact_notification_cc_recipients)

  return {
    confirmationSenderEmail: contactSenderEmail,
    confirmationRecipientEmail: requireEmail(body.email),
    notificationSenderEmail: contactSenderEmail,
    notificationRecipients: notificationRecipients.length > 0
      ? notificationRecipients
      : fallbackRecipient
        ? [fallbackRecipient]
        : ['washingtonlopes2003@gmail.com'],
    notificationCcRecipients,
  }
}

function resolveContactSenderEmail(settings: SiteSettingsRow): string {
  const provider = normalizeEmailProvider(settings.email_provider)
  const featureSender =
    normalizeEmail(settings.contact_notification_sender_email) ??
    normalizeEmail(settings.contact_confirmation_sender_email)
  const globalSender =
    normalizeEmail(settings.email_from_address) ??
    normalizeEmail(Deno.env.get('CONTACT_EMAIL_FROM')) ??
    normalizeEmail(settings.email_sender_address) ??
    'washingtonlopes2003@gmail.com'

  if (usesFeatureSenderAliases(provider)) {
    return featureSender ?? globalSender
  }

  return globalSender
}

function usesFeatureSenderAliases(provider: EmailProvider): boolean {
  return provider === 'smtp' || provider === 'resend'
}

function buildEmailDeliveryConfig(settings: SiteSettingsRow): EmailDeliveryConfig {
  return {
    provider: normalizeEmailProvider(settings.email_provider),
    fromName: normalizeText(settings.email_from_name) ??
      normalizeText(settings.email_sender_name) ??
      'KW Advocacia',
    fromEmail: normalizeEmail(settings.email_from_address) ??
      normalizeEmail(settings.contact_notification_sender_email) ??
      normalizeEmail(settings.email_sender_address) ??
      'washingtonlopes2003@gmail.com',
    replyToEmail: normalizeEmail(settings.email_reply_to),
    smtpHost: normalizeText(settings.email_smtp_host) ?? '',
    smtpPort: normalizeSmtpPort(settings.email_smtp_port),
    smtpSecurity: normalizeSmtpSecurity(settings.email_smtp_security),
    smtpUsername: normalizeText(settings.email_smtp_username) ?? '',
    smtpPasswordSecret: normalizeText(settings.email_smtp_password_secret) ?? '',
  }
}

function normalizeRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .map((recipient) => normalizeEmail(recipient))
        .filter((recipient): recipient is string => Boolean(recipient)),
    ),
  )
}

function normalizeMessageStatus(value: unknown): MessageStatus {
  if (value === 'read' || value === 'archived') {
    return value
  }

  return 'unread'
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

  if (security === 'none' || security === 'ssl' || security === 'starttls') {
    return security
  }

  return 'starttls'
}

function normalizeSmtpPort(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed
    }
  }

  return 587
}

function mapContactMessage(message: ContactMessageRow | null): Record<string, unknown> | null {
  if (!message) {
    return null
  }

  return {
    id: parsePositiveInteger(message.id),
    name: normalizeText(message.name) ?? '',
    email: normalizeText(message.email) ?? '',
    phone: normalizeText(message.phone) ?? '',
    message: normalizeText(message.message) ?? '',
    status: normalizeMessageStatus(message.status),
    emailConfirmationSent: message.email_confirmation_sent === true,
    emailNotificationSent: message.email_notification_sent === true,
    emailDeliveryError: normalizeText(message.email_delivery_error),
    confirmationSenderEmail: normalizeText(message.confirmation_sender_email) ?? '',
    confirmationRecipientEmail: normalizeText(message.confirmation_recipient_email) ?? '',
    notificationSenderEmail: normalizeText(message.notification_sender_email) ?? '',
    notificationRecipientEmails: Array.isArray(message.notification_recipient_emails)
      ? message.notification_recipient_emails
      : [],
    notificationCcEmails: Array.isArray(message.notification_cc_emails)
      ? message.notification_cc_emails
      : [],
    createdAt: normalizeText(message.created_at),
    readAt: normalizeText(message.read_at),
  }
}

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

async function readRequestBody(req: Request): Promise<ContactMessageRequest> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body as ContactMessageRequest : {}
  } catch {
    throw new RequestError('JSON invalido na requisicao.')
  }
}

async function requireAuthenticatedRequest(req: Request): Promise<void> {
  const accessToken = extractBearerToken(req.headers.get('authorization'))

  if (!accessToken) {
    throw new RequestError('Sessao autenticada obrigatoria para gerenciar mensagens.', 401)
  }

  const client = createUserScopedClient(accessToken)
  const { data, error } = await client.auth.getUser()

  if (error || !data.user) {
    throw new RequestError('Sessao autenticada obrigatoria para gerenciar mensagens.', 401)
  }
}

function createUserScopedClient(accessToken: string): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })
}

function getSupabaseUrl(): string {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''

  if (!supabaseUrl) {
    throw new RequestError('Variavel SUPABASE_URL e obrigatoria.', 500)
  }

  return supabaseUrl
}

function getSupabaseAnonKey(): string {
  const anonKey =
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ??
    Deno.env.get('ANON_KEY') ??
    ''

  if (!anonKey) {
    throw new RequestError('Variavel SUPABASE_ANON_KEY e obrigatoria.', 500)
  }

  return anonKey
}

function extractBearerToken(authorizationHeader: string | null): string {
  return authorizationHeader?.replace(/^Bearer\s+/i, '').trim() ?? ''
}

function requireEmail(value: unknown): string {
  const email = normalizeEmail(value)

  if (!email) {
    throw new RequestError('Informe um e-mail valido.')
  }

  return email
}

function requireBoundedText(value: unknown, errorMessage: string, maxLength: number): string {
  const text = normalizeText(value)

  if (!text) {
    throw new RequestError(errorMessage)
  }

  if (text.length > maxLength) {
    throw new RequestError(`Campo com limite de ${maxLength} caracteres excedido.`)
  }

  return text
}

function requirePhone(value: unknown): string {
  const phone = requireBoundedText(value, 'Informe seu telefone.', 60)

  if (!/^[+()\d\s-]{8,60}$/.test(phone)) {
    throw new RequestError('Telefone invalido.')
  }

  return phone
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
      .join(' ') || 'Nao foi possivel processar a mensagem.'
  }

  return 'Nao foi possivel processar a mensagem.'
}

function extractErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const status = (error as Record<string, unknown>)['status']
  return typeof status === 'number' ? status : null
}
