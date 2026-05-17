import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sendTransactionalEmail, type EmailDeliveryConfig, type EmailProvider, type SmtpSecurity } from '../_shared/email-delivery.ts'

type AuthCmsAction = 'login' | 'forgot-password' | 'update-password'

interface AuthCmsRequest {
  action?: AuthCmsAction | null
  email?: string | null
  password?: string | null
  accessToken?: string | null
  tokenHash?: string | null
  redirectTo?: string | null
}

interface PublicUserRow {
  id?: number | null
  email?: string | null
  name?: string | null
  status?: boolean | null
  auth_user_id?: string | null
}

interface SiteSettingsRow {
  password_recovery_sender_email?: string | null
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

class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ message: 'Metodo nao permitido.' }, 405)
  }

  try {
    const body = await readRequestBody(req)
    const adminClient = createAdminClient()

    if (body.action === 'login') {
      return await login(adminClient, body)
    }

    if (body.action === 'forgot-password') {
      return await requestPasswordReset(adminClient, body)
    }

    if (body.action === 'update-password') {
      return await updatePassword(body)
    }

    throw new RequestError("Acao invalida. Envie 'login', 'forgot-password' ou 'update-password'.")
  } catch (error) {
    const message = extractErrorMessage(error)
    const status = error instanceof RequestError ? error.status : extractErrorStatus(error) ?? 400

    return jsonResponse({ error: message, erro: message, message }, status)
  }
})

async function login(adminClient: SupabaseClient, body: AuthCmsRequest): Promise<Response> {
  const email = requireEmail(body.email)
  const password = requirePassword(body.password)
  const publicUser = await findPublicUserByEmail(adminClient, email)

  if (!publicUser || publicUser.status === false) {
    throw new RequestError('E-mail ou senha incorretos.', 401)
  }

  const authClient = createAnonClient()
  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.session) {
    throw new RequestError('E-mail ou senha incorretos.', 401)
  }

  if (data.user?.id && publicUser.auth_user_id !== data.user.id) {
    await adminClient
      .from('users')
      .update({ auth_user_id: data.user.id, updated_at: new Date().toISOString() })
      .eq('id', publicUser.id)
  }

  return jsonResponse({
    access_token: data.session.access_token,
    expires_at: data.session.expires_at,
    expires_in: data.session.expires_in,
    refresh_token: data.session.refresh_token,
    token_type: data.session.token_type,
    user: {
      ...data.user,
      public_user_id: publicUser.id,
      name: publicUser.name,
      status: publicUser.status,
    },
  })
}

async function requestPasswordReset(adminClient: SupabaseClient, body: AuthCmsRequest): Promise<Response> {
  const email = requireEmail(body.email)
  const publicUser = await findPublicUserByEmail(adminClient, email)

  if (publicUser && publicUser.status !== false) {
    const redirectTo = getPasswordResetRedirectUrl(body.redirectTo)
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo,
      },
    })

    if (error) {
      throw error
    }

    const actionLink = buildPasswordResetLink(redirectTo, data)
    const settings = await getSiteSettings(adminClient)
    const emailConfig = buildEmailDeliveryConfig(settings)
    await sendEmail({
      fromEmail: resolvePasswordRecoverySenderEmail(settings, emailConfig),
      fromName: normalizeText(emailConfig.fromName) ?? 'KW Advocacia',
      to: [email],
      subject: 'Recuperacao de senha',
      html: renderPasswordRecoveryEmail(publicUser, actionLink),
    }, emailConfig)
  }

  return jsonResponse({
    mensagem: 'Se o e-mail estiver cadastrado, voce recebera um link de redefinicao.',
  })
}

async function getSiteSettings(supabase: SupabaseClient): Promise<SiteSettingsRow> {
  const { data, error } = await supabase
    .from('site_settings')
    .select('password_recovery_sender_email,email_provider,email_from_name,email_from_address,email_reply_to,email_smtp_host,email_smtp_port,email_smtp_security,email_smtp_username,email_smtp_password_secret')
    .eq('id', 1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data ?? {}
}

function buildEmailDeliveryConfig(settings: SiteSettingsRow): EmailDeliveryConfig {
  return {
    provider: normalizeEmailProvider(settings.email_provider),
    fromName: normalizeText(settings.email_from_name) ?? 'KW Advocacia',
    fromEmail: normalizeEmail(settings.email_from_address) ??
      normalizeEmail(settings.password_recovery_sender_email) ??
      'washingtonlopes2003@gmail.com',
    replyToEmail: normalizeEmail(settings.email_reply_to),
    smtpHost: normalizeText(settings.email_smtp_host) ?? '',
    smtpPort: normalizeSmtpPort(settings.email_smtp_port),
    smtpSecurity: normalizeSmtpSecurity(settings.email_smtp_security),
    smtpUsername: normalizeText(settings.email_smtp_username) ?? '',
    smtpPasswordSecret: normalizeText(settings.email_smtp_password_secret) ?? '',
  }
}

function resolvePasswordRecoverySenderEmail(
  settings: SiteSettingsRow,
  config: EmailDeliveryConfig,
): string {
  const provider = normalizeEmailProvider(settings.email_provider)

  if (provider === 'smtp') {
    return normalizeEmail(settings.password_recovery_sender_email) ??
      normalizeEmail(config.fromEmail) ??
      'washingtonlopes2003@gmail.com'
  }

  return normalizeEmail(config.fromEmail) ??
    normalizeEmail(settings.password_recovery_sender_email) ??
    'washingtonlopes2003@gmail.com'
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

function buildPasswordResetLink(redirectTo: string, data: unknown): string {
  const tokenHash = extractRecoveryTokenHash(data)
  if (tokenHash) {
    const url = new URL(redirectTo)
    url.searchParams.set('token_hash', tokenHash)
    url.searchParams.set('type', 'recovery')
    return url.toString()
  }

  return extractActionLink(data)
}

function extractRecoveryTokenHash(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const record = data as Record<string, unknown>
  const properties = record['properties']
  if (properties && typeof properties === 'object') {
    const propertiesRecord = properties as Record<string, unknown>
    const directToken = normalizeText(propertiesRecord['hashed_token']) ??
      normalizeText(propertiesRecord['token_hash'])

    if (directToken) {
      return directToken
    }

    const actionLink = normalizeText(propertiesRecord['action_link'])
    const tokenFromLink = extractRecoveryTokenHashFromActionLink(actionLink)
    if (tokenFromLink) {
      return tokenFromLink
    }
  }

  return null
}

function extractRecoveryTokenHashFromActionLink(actionLink: string | null): string | null {
  if (!actionLink) {
    return null
  }

  try {
    const url = new URL(actionLink)
    return normalizeText(url.searchParams.get('token_hash')) ??
      normalizeText(url.searchParams.get('token'))
  } catch {
    return null
  }
}

function extractActionLink(data: unknown): string {
  if (!data || typeof data !== 'object') {
    throw new RequestError('Nao foi possivel gerar o link de recuperacao.', 500)
  }

  const record = data as Record<string, unknown>
  const properties = record['properties']
  if (properties && typeof properties === 'object') {
    const actionLink = (properties as Record<string, unknown>)['action_link']
    if (typeof actionLink === 'string' && actionLink.trim()) {
      return actionLink.trim()
    }
  }

  throw new RequestError('Nao foi possivel gerar o link de recuperacao.', 500)
}

async function sendEmail(options: {
  fromEmail: string
  fromName: string
  to: string[]
  subject: string
  html: string
}, config: EmailDeliveryConfig): Promise<void> {
  const result = await sendTransactionalEmail({
    ...options,
    cc: [],
  }, config)

  if (!result.sent) {
    throw new RequestError(result.error ?? 'Falha ao enviar e-mail.', 502)
  }
}

function renderPasswordRecoveryEmail(publicUser: PublicUserRow, actionLink: string): string {
  const name = escapeHtml(normalizeText(publicUser.name) ?? 'tudo bem')

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#1f2937">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px">
        <h1 style="margin:0 0 14px;color:#273F4B;font-size:22px">Recuperacao de senha</h1>
        <p style="margin:0 0 12px;line-height:1.6">Ola, ${name}.</p>
        <p style="margin:0 0 20px;line-height:1.6">Recebemos uma solicitacao para redefinir sua senha de acesso ao CMS.</p>
        <a href="${escapeHtml(actionLink)}" style="display:inline-block;background:#273F4B;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700">Redefinir senha</a>
        <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#64748b">Se voce nao solicitou essa alteracao, ignore este e-mail.</p>
      </div>
    </div>
  `
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function updatePassword(body: AuthCmsRequest): Promise<Response> {
  const password = requirePassword(body.password)
  const accessToken = normalizeText(body.accessToken) ??
    await verifyPasswordRecoveryToken(body.tokenHash)

  if (!accessToken) {
    throw new RequestError('Token de recuperacao invalido ou expirado.', 401)
  }

  const client = createUserScopedClient(accessToken)
  const { error } = await client.auth.updateUser({ password })

  if (error) {
    throw error
  }

  return jsonResponse({
    mensagem: 'Senha atualizada com sucesso.',
  })
}

async function verifyPasswordRecoveryToken(tokenHash: unknown): Promise<string | null> {
  const token = normalizeText(tokenHash)
  if (!token) {
    return null
  }

  const client = createAnonClient()
  const { data, error } = await client.auth.verifyOtp({
    token_hash: token,
    type: 'recovery',
  })

  if (error || !data.session?.access_token) {
    throw error ?? new RequestError('Token de recuperacao invalido ou expirado.', 401)
  }

  return data.session.access_token
}

async function findPublicUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<PublicUserRow | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id,email,name,status,auth_user_id')
    .eq('email', email)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
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

function createAnonClient(): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
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

function getPasswordResetRedirectUrl(requestedRedirectTo?: string | null): string {
  return resolveAllowedRedirectUrl(requestedRedirectTo, '/redefinir-senha') ??
    normalizeText(Deno.env.get('CMS_PASSWORD_RESET_REDIRECT_URL')) ??
    'https://admin.washingtonlopes.com/redefinir-senha'
}

function resolveAllowedRedirectUrl(value: unknown, expectedPath: '/redefinir-senha' | '/login'): string | null {
  const text = normalizeText(value)
  if (!text) {
    return null
  }

  try {
    const url = new URL(text)
    const isExpectedPath = url.pathname === expectedPath
    const isProductionCms = url.protocol === 'https:' && url.hostname === 'admin.washingtonlopes.com'
    const isLocalhost = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)

    return isExpectedPath && (isProductionCms || isLocalhost) ? url.toString() : null
  } catch {
    return null
  }
}

async function readRequestBody(req: Request): Promise<AuthCmsRequest> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body as AuthCmsRequest : {}
  } catch {
    throw new RequestError('JSON invalido na requisicao.')
  }
}

function requireEmail(value: unknown): string {
  const email = normalizeEmail(value)

  if (!email) {
    throw new RequestError('Informe um e-mail valido.')
  }

  return email
}

function requirePassword(value: unknown): string {
  const password = normalizeText(value)

  if (!password || password.length < 6) {
    throw new RequestError('Informe uma senha com pelo menos 6 caracteres.')
  }

  return password
}

function normalizeEmail(value: unknown): string | null {
  const text = normalizeText(value)
  if (!text || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return null
  }

  return text.toLowerCase()
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized || null
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
      .join(' ') || 'Nao foi possivel processar autenticacao.'
  }

  return 'Nao foi possivel processar autenticacao.'
}

function extractErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const status = (error as Record<string, unknown>)['status']
  return typeof status === 'number' ? status : null
}
