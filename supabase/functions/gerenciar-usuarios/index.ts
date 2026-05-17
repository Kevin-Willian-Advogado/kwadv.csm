import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sendTransactionalEmail, type EmailDeliveryConfig, type EmailProvider, type SmtpSecurity } from '../_shared/email-delivery.ts'

type UserAction = 'list' | 'get' | 'create' | 'edit' | 'delete'

interface ManageUserRequest {
  acao?: UserAction | null
  id?: string | number | null
  userId?: string | number | null
  authUserId?: string | null
  email?: string | null
  currentEmail?: string | null
  previousEmail?: string | null
  password?: string | null
  passwordRedirectTo?: string | null
  emailChangeRedirectTo?: string | null
  nome?: string | null
  displayName?: string | null
  status?: boolean | number | string | null
  isActive?: boolean | null
}

interface JwtPayload {
  role?: unknown
  email?: unknown
}

interface PublicUserRow {
  id?: number | null
  auth_user_id?: string | null
  email?: string | null
  password_hash?: string | null
  created_at?: string | null
  created_by?: number | null
  updated_at?: string | null
  updated_by?: number | null
  name?: string | null
  status?: boolean | null
}

interface SiteSettingsRow {
  user_validation_sender_email?: string | null
  email_change_sender_email?: string | null
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

const passwordHashMarker = 'supabase-auth'
const fallbackActorId = 10447
const publicUserBaseSelect = 'id,auth_user_id,email,password_hash,created_at,created_by,updated_at,updated_by'
const publicUserProfileSelect = `${publicUserBaseSelect},name,status`

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
    const authPayload = requireAuthenticatedRequest(req)
    const body = await readRequestBody(req)
    const supabase = createAdminClient()
    const actorId = await resolveActorId(supabase, authPayload)

    if (body.acao === 'list') {
      return await listUsers(supabase)
    }

    if (body.acao === 'get') {
      return await getUser(supabase, body)
    }

    if (body.acao === 'create') {
      return await createUser(supabase, body, actorId)
    }

    if (body.acao === 'edit') {
      return await editUser(supabase, body, actorId)
    }

    if (body.acao === 'delete') {
      return await deleteUser(supabase, body)
    }

    throw new RequestError("Acao invalida. Envie 'list', 'get', 'create', 'edit' ou 'delete'.")
  } catch (error) {
    const message = extractErrorMessage(error)
    const status = error instanceof RequestError ? error.status : extractErrorStatus(error) ?? 400

    return jsonResponse({ error: message, erro: message, message }, status)
  }
})

async function listUsers(supabase: SupabaseClient): Promise<Response> {
  const { data, error } = await supabase
    .from('users')
    .select(publicUserProfileSelect)
    .order('id', { ascending: true })

  if (error) {
    throw error
  }

  return jsonResponse({
    data: {
      users: data ?? [],
    },
  })
}

async function getUser(supabase: SupabaseClient, body: ManageUserRequest): Promise<Response> {
  const publicUser = await resolvePublicUser(supabase, body, false)

  return jsonResponse({
    data: {
      publicUser,
    },
  })
}

async function createUser(
  supabase: SupabaseClient,
  body: ManageUserRequest,
  actorId: number,
): Promise<Response> {
  const email = requireEmail(body.email)
  const displayName = getDisplayName(body, email)
  const authUser = await createOrFindAuthUser(supabase, email, displayName)
  const publicUser = await createPublicUser(supabase, body, email, displayName, authUser?.id ?? null, actorId)
  const definitionEmail = await sendUserDefinitionEmail(
    supabase,
    publicUser,
    displayName,
    body.passwordRedirectTo,
  )

  return jsonResponse({
    mensagem: 'Usuario criado com sucesso.',
    data: {
      authUser: {
        id: authUser?.id ?? null,
        email: authUser?.email ?? email,
      },
      publicUser,
      userDefinitionEmailSent: definitionEmail.sent,
      userDefinitionEmailError: definitionEmail.error,
    },
  })
}

async function sendUserDefinitionEmail(
  supabase: SupabaseClient,
  publicUser: PublicUserRow,
  displayName: string,
  requestedRedirectTo?: string | null,
): Promise<{ sent: boolean; error: string | null }> {
  const email = normalizeEmail(publicUser.email)
  if (!email) {
    return { sent: false, error: 'Usuario sem e-mail valido.' }
  }

  try {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: getUserPasswordRedirectUrl(requestedRedirectTo),
      },
    })

    if (error) {
      throw error
    }

    const actionLink = buildPasswordResetLink(getUserPasswordRedirectUrl(requestedRedirectTo), data)
    const settings = await getSiteSettings(supabase)
    const emailConfig = buildEmailDeliveryConfig(settings)

    await sendEmail({
      fromEmail: resolveUserCreationSenderEmail(settings, emailConfig),
      fromName: normalizeText(emailConfig.fromName) ?? 'KW Advocacia',
      to: [email],
      subject: 'Definicao de senha do CMS',
      html: renderUserDefinitionEmail(displayName, actionLink),
    }, emailConfig)

    return { sent: true, error: null }
  } catch (error) {
    const message = extractErrorMessage(error)
    console.warn('Nao foi possivel enviar e-mail de definicao de senha:', message)
    return { sent: false, error: message }
  }
}

async function sendUserEmailChangeValidationEmail(
  supabase: SupabaseClient,
  publicUserId: number,
  authUserId: string,
  previousEmail: string,
  newEmail: string,
  displayName: string,
  requestedBy: number,
  requestedRedirectTo?: string | null,
): Promise<{ sent: boolean; error: string | null }> {
  let tokenHash: string | null = null

  try {
    const token = generateEmailChangeToken()
    tokenHash = await hashEmailChangeToken(token)

    await createPendingEmailChange(supabase, {
      publicUserId,
      authUserId,
      previousEmail,
      newEmail,
      tokenHash,
      requestedBy,
    })

    const actionLink = buildEmailChangeValidationLink(getEmailChangeRedirectUrl(requestedRedirectTo), token)
    const settings = await getSiteSettings(supabase)
    const emailConfig = buildEmailDeliveryConfig(settings)

    await sendEmail({
      fromEmail: resolveEmailChangeSenderEmail(settings, emailConfig),
      fromName: normalizeText(emailConfig.fromName) ?? 'KW Advocacia',
      to: [newEmail],
      subject: 'Validacao de novo e-mail',
      html: renderUserEmailChangeValidationEmail(displayName, previousEmail, newEmail, actionLink),
    }, emailConfig)

    return { sent: true, error: null }
  } catch (error) {
    if (tokenHash) {
      await discardPendingEmailChange(supabase, tokenHash)
    }

    const message = extractErrorMessage(error)
    console.warn('Nao foi possivel enviar e-mail de validacao de novo e-mail:', message)
    return { sent: false, error: message }
  }
}

async function createPendingEmailChange(
  supabase: SupabaseClient,
  payload: {
    publicUserId: number
    authUserId: string
    previousEmail: string
    newEmail: string
    tokenHash: string
    requestedBy: number
  },
): Promise<void> {
  const { error: consumeError } = await supabase
    .from('pending_email_changes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('public_user_id', payload.publicUserId)
    .is('consumed_at', null)

  if (consumeError) {
    throw consumeError
  }

  const { error } = await supabase
    .from('pending_email_changes')
    .insert({
      public_user_id: payload.publicUserId,
      auth_user_id: payload.authUserId,
      previous_email: payload.previousEmail,
      new_email: payload.newEmail,
      token_hash: payload.tokenHash,
      requested_by: payload.requestedBy,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    })

  if (error) {
    throw error
  }
}

async function discardPendingEmailChange(
  supabase: SupabaseClient,
  tokenHash: string,
): Promise<void> {
  await supabase
    .from('pending_email_changes')
    .delete()
    .eq('token_hash', tokenHash)
}

async function editUser(
  supabase: SupabaseClient,
  body: ManageUserRequest,
  actorId: number,
): Promise<Response> {
  const publicUser = await resolvePublicUser(supabase, body, true)
  const publicUserId = parsePositiveInteger(publicUser?.id)

  if (!publicUser || publicUserId === null) {
    throw new RequestError('Usuario nao encontrado.', 404)
  }

  const currentEmail = requireEmail(publicUser.email)
  const email = normalizeEmail(body.email) ?? currentEmail
  const emailChanged = email !== currentEmail
  const displayName = getOptionalDisplayName(body)
  let authUserId = await resolveAuthUserId(supabase, {
    ...body,
    authUserId: publicUser.auth_user_id ?? body.authUserId,
    currentEmail,
    previousEmail: currentEmail,
    email,
  }, false)

  if (normalizeText(body.password)) {
    throw new RequestError('Alteracao de senha de terceiros nao e permitida. Use o fluxo esqueci a senha.')
  }

  if (authUserId) {
    await updateAuthUser(supabase, authUserId, {
      displayName,
    })
  }

  if (emailChanged) {
    if (!authUserId) {
      throw new RequestError('Usuario do Auth nao encontrado para validar a alteracao de e-mail.', 404)
    }

    const existingEmailOwner = await findPublicUserByEmail(supabase, email)
    const existingEmailOwnerId = parsePositiveInteger(existingEmailOwner?.id)

    if (existingEmailOwnerId !== null && existingEmailOwnerId !== publicUserId) {
      throw new RequestError('Ja existe outro usuario com este e-mail.', 409)
    }
  }

  const emailChangeValidation = emailChanged
    ? await sendUserEmailChangeValidationEmail(
      supabase,
      publicUserId,
      authUserId as string,
      currentEmail,
      email,
      displayName ?? normalizeText(publicUser.name) ?? email.split('@')[0] ?? 'Usuario',
      actorId,
      body.emailChangeRedirectTo,
    )
    : { sent: false, error: null }

  if (emailChanged && !emailChangeValidation.sent) {
    throw new RequestError(emailChangeValidation.error ?? 'Nao foi possivel enviar o link de validacao do novo e-mail.', 502)
  }

  const updatePayload: Record<string, unknown> = {
    email: emailChanged ? currentEmail : email,
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  }

  if (authUserId) {
    updatePayload['auth_user_id'] = authUserId
  }

  if (displayName) {
    updatePayload['name'] = displayName
  }

  if (
    (body.isActive !== undefined && body.isActive !== null) ||
    (body.status !== undefined && body.status !== null)
  ) {
    updatePayload['status'] = resolveUserStatus(body)
  }

  const { data, error } = await supabase
    .from('users')
    .update(updatePayload)
    .eq('id', publicUserId)
    .select(publicUserProfileSelect)
    .single()

  if (error) {
    throw error
  }

  return jsonResponse({
    mensagem: 'Usuario atualizado com sucesso.',
    data: {
      authUser: {
        id: authUserId,
        email: emailChanged ? currentEmail : email,
      },
      publicUser: data,
      pendingEmail: emailChanged ? email : null,
      userEmailChangeValidationSent: emailChangeValidation.sent,
      userEmailChangeValidationError: emailChangeValidation.error,
    },
  })
}

async function deleteUser(supabase: SupabaseClient, body: ManageUserRequest): Promise<Response> {
  const publicUser = await resolvePublicUser(supabase, body, false)
  const authUserId = await resolveAuthUserId(supabase, {
    ...body,
    authUserId: publicUser?.auth_user_id ?? body.authUserId,
    currentEmail: publicUser?.email ?? body.currentEmail,
    previousEmail: publicUser?.email ?? body.previousEmail,
    email: publicUser?.email ?? body.email,
  }, false)

  if (authUserId) {
    const { error } = await supabase.auth.admin.deleteUser(authUserId)

    if (error) {
      throw error
    }
  }

  const publicUserId = parsePositiveInteger(publicUser?.id)
  if (publicUserId !== null) {
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', publicUserId)

    if (error) {
      throw error
    }
  }

  return jsonResponse({
    mensagem: 'Usuario excluido com sucesso.',
    data: {
      id: publicUserId,
      authUserId,
    },
  })
}

async function createOrFindAuthUser(
  supabase: SupabaseClient,
  email: string,
  displayName: string,
): Promise<{ id?: string | null; email?: string | null } | null> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: generateTemporaryPassword(),
    email_confirm: true,
    user_metadata: buildUserMetadata(displayName),
  })

  if (error && !isExistingAuthUserError(error)) {
    throw error
  }

  if (data?.user) {
    return data.user
  }

  const existingAuthUser = await findAuthUserByEmail(supabase, email)
  if (existingAuthUser?.id) {
    await updateAuthUser(supabase, existingAuthUser.id, {
      displayName,
    })
  }

  return existingAuthUser
}

function generateTemporaryPassword(): string {
  return `${crypto.randomUUID()}Aa1!`
}

async function updateAuthUser(
  supabase: SupabaseClient,
  authUserId: string,
  updates: { email?: string | null; displayName?: string | null },
): Promise<void> {
  const requestBody: Record<string, unknown> = {}

  if (updates.email) {
    requestBody['email'] = updates.email
    requestBody['email_confirm'] = true
  }

  if (updates.displayName) {
    requestBody['user_metadata'] = buildUserMetadata(updates.displayName)
  }

  if (Object.keys(requestBody).length === 0) {
    return
  }

  const { error } = await supabase.auth.admin.updateUserById(authUserId, requestBody)

  if (error) {
    throw error
  }
}

async function createPublicUser(
  supabase: SupabaseClient,
  body: ManageUserRequest,
  email: string,
  displayName: string,
  authUserId: string | null,
  actorId: number,
): Promise<PublicUserRow> {
  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    auth_user_id: authUserId,
    email,
    name: displayName,
    status: resolveUserStatus(body),
    password_hash: passwordHashMarker,
    created_at: now,
    created_by: actorId,
    updated_at: now,
    updated_by: actorId,
  }

  const { data, error } = await supabase
    .from('users')
    .insert(payload)
    .select(publicUserProfileSelect)
    .single()

  if (error) {
    if (isUniqueConstraintError(error)) {
      const existingUser = await findPublicUserByEmail(supabase, email)

      if (existingUser) {
        return await updateExistingPublicUserFromCreate(supabase, existingUser, {
          authUserId,
          displayName,
          isActive: resolveUserStatus(body),
          actorId,
        })
      }
    }

    throw error
  }

  if (!data) {
    throw new RequestError('A tabela users nao retornou o usuario criado.', 500)
  }

  return data
}

async function updateExistingPublicUserFromCreate(
  supabase: SupabaseClient,
  user: PublicUserRow,
  updates: { authUserId: string | null; displayName: string; isActive: boolean; actorId: number },
): Promise<PublicUserRow> {
  const publicUserId = parsePositiveInteger(user.id)

  if (publicUserId === null) {
    return user
  }

  const payload: Record<string, unknown> = {
    name: updates.displayName,
    status: updates.isActive,
    updated_at: new Date().toISOString(),
    updated_by: updates.actorId,
  }

  if (updates.authUserId) {
    payload['auth_user_id'] = updates.authUserId
  }

  const { data, error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', publicUserId)
    .select(publicUserProfileSelect)
    .single()

  if (error) {
    throw error
  }

  return data ?? user
}

async function resolvePublicUser(
  supabase: SupabaseClient,
  body: ManageUserRequest,
  required: true,
): Promise<PublicUserRow>
async function resolvePublicUser(
  supabase: SupabaseClient,
  body: ManageUserRequest,
  required?: false,
): Promise<PublicUserRow | null>
async function resolvePublicUser(
  supabase: SupabaseClient,
  body: ManageUserRequest,
  required = false,
): Promise<PublicUserRow | null> {
  const publicUserId = parsePositiveInteger(body.userId) ?? parsePositiveInteger(body.id)

  if (publicUserId !== null) {
    const user = await findPublicUserById(supabase, publicUserId)

    if (user || !required) {
      return user
    }
  }

  const email = normalizeEmail(body.email) ?? normalizeEmail(body.currentEmail) ?? normalizeEmail(body.previousEmail)

  if (email) {
    const user = await findPublicUserByEmail(supabase, email)

    if (user || !required) {
      return user
    }
  }

  if (required) {
    throw new RequestError('Usuario nao encontrado.', 404)
  }

  return null
}

async function findPublicUserById(supabase: SupabaseClient, userId: number): Promise<PublicUserRow | null> {
  const { data, error } = await supabase
    .from('users')
    .select(publicUserProfileSelect)
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function findPublicUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<PublicUserRow | null> {
  const { data, error } = await supabase
    .from('users')
    .select(publicUserProfileSelect)
    .eq('email', email)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function resolveAuthUserId(
  supabase: SupabaseClient,
  body: ManageUserRequest,
  required = true,
): Promise<string | null> {
  const explicitAuthUserId = parseAuthUserId(body.authUserId) ?? parseAuthUserId(body.id)

  if (explicitAuthUserId) {
    return explicitAuthUserId
  }

  const candidateEmails = [body.currentEmail, body.previousEmail, body.email]
    .map((value) => normalizeEmail(value))
    .filter((value): value is string => Boolean(value))

  for (const email of candidateEmails) {
    const user = await findAuthUserByEmail(supabase, email)

    if (user?.id) {
      return user.id
    }
  }

  if (required) {
    throw new RequestError('Usuario do Auth nao encontrado.', 404)
  }

  return null
}

async function findAuthUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<{ id?: string; email?: string } | null> {
  const perPage = 1000

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })

    if (error) {
      throw error
    }

    const users = data.users ?? []
    const foundUser = users.find((user) => normalizeEmail(user.email) === email)

    if (foundUser) {
      return foundUser
    }

    if (users.length < perPage) {
      return null
    }
  }

  return null
}

async function getSiteSettings(supabase: SupabaseClient): Promise<SiteSettingsRow> {
  const { data, error } = await supabase
    .from('site_settings')
    .select('user_validation_sender_email,email_change_sender_email,email_provider,email_from_name,email_from_address,email_reply_to,email_smtp_host,email_smtp_port,email_smtp_security,email_smtp_username,email_smtp_password_secret')
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
      normalizeEmail(settings.user_validation_sender_email) ??
      normalizeEmail(settings.email_change_sender_email) ??
      'washingtonlopes2003@gmail.com',
    replyToEmail: normalizeEmail(settings.email_reply_to),
    smtpHost: normalizeText(settings.email_smtp_host) ?? '',
    smtpPort: normalizeSmtpPort(settings.email_smtp_port),
    smtpSecurity: normalizeSmtpSecurity(settings.email_smtp_security),
    smtpUsername: normalizeText(settings.email_smtp_username) ?? '',
    smtpPasswordSecret: normalizeText(settings.email_smtp_password_secret) ?? '',
  }
}

function resolveUserCreationSenderEmail(
  settings: SiteSettingsRow,
  config: EmailDeliveryConfig,
): string {
  const provider = normalizeEmailProvider(settings.email_provider)

  if (provider === 'smtp') {
    return normalizeEmail(settings.user_validation_sender_email) ??
      normalizeEmail(config.fromEmail) ??
      'washingtonlopes2003@gmail.com'
  }

  return normalizeEmail(config.fromEmail) ??
    normalizeEmail(settings.user_validation_sender_email) ??
    'washingtonlopes2003@gmail.com'
}

function resolveEmailChangeSenderEmail(
  settings: SiteSettingsRow,
  config: EmailDeliveryConfig,
): string {
  const provider = normalizeEmailProvider(settings.email_provider)

  if (provider === 'smtp') {
    return normalizeEmail(settings.email_change_sender_email) ??
      normalizeEmail(config.fromEmail) ??
      'washingtonlopes2003@gmail.com'
  }

  return normalizeEmail(config.fromEmail) ??
    normalizeEmail(settings.email_change_sender_email) ??
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

function getUserPasswordRedirectUrl(requestedRedirectTo?: string | null): string {
  return resolveAllowedRedirectUrl(requestedRedirectTo, '/redefinir-senha') ??
    normalizeText(Deno.env.get('CMS_USER_PASSWORD_REDIRECT_URL')) ??
    normalizeText(Deno.env.get('CMS_PASSWORD_RESET_REDIRECT_URL')) ??
    'https://admin.washingtonlopes.com/redefinir-senha'
}

function getEmailChangeRedirectUrl(requestedRedirectTo?: string | null): string {
  return resolveAllowedRedirectUrl(requestedRedirectTo, '/validar-email') ??
    normalizeText(Deno.env.get('CMS_EMAIL_CHANGE_REDIRECT_URL')) ??
    'https://admin.washingtonlopes.com/validar-email'
}

function resolveAllowedRedirectUrl(value: unknown, expectedPath: '/redefinir-senha' | '/validar-email'): string | null {
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

function buildPasswordResetLink(redirectTo: string, data: unknown): string {
  const tokenHash = extractActionTokenHash(data)
  if (tokenHash) {
    const url = new URL(redirectTo)
    url.searchParams.set('token_hash', tokenHash)
    url.searchParams.set('type', 'recovery')
    return url.toString()
  }

  return extractActionLink(data)
}

function buildEmailChangeValidationLink(redirectTo: string, token: string): string {
  const url = new URL(redirectTo)
  url.searchParams.set('token', token)
  url.searchParams.set('type', 'email_change')
  return url.toString()
}

function generateEmailChangeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return bytesToBase64Url(bytes)
}

async function hashEmailChangeToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token) as BufferSource)
  return bytesToHex(new Uint8Array(digest))
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function extractActionTokenHash(data: unknown): string | null {
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
    const tokenFromLink = extractTokenHashFromActionLink(actionLink)
    if (tokenFromLink) {
      return tokenFromLink
    }
  }

  return null
}

function extractTokenHashFromActionLink(actionLink: string | null): string | null {
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
    throw new RequestError('Nao foi possivel gerar o link de acao.', 500)
  }

  const record = data as Record<string, unknown>
  const properties = record['properties']
  if (properties && typeof properties === 'object') {
    const actionLink = (properties as Record<string, unknown>)['action_link']
    if (typeof actionLink === 'string' && actionLink.trim()) {
      return actionLink.trim()
    }
  }

  throw new RequestError('Nao foi possivel gerar o link de acao.', 500)
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

function renderUserDefinitionEmail(displayName: string, actionLink: string): string {
  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#1f2937">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px">
        <h1 style="margin:0 0 14px;color:#273F4B;font-size:22px">Acesso ao CMS</h1>
        <p style="margin:0 0 12px;line-height:1.6">Ola, ${escapeHtml(displayName)}.</p>
        <p style="margin:0 0 20px;line-height:1.6">Seu usuario foi preparado. Defina sua senha para acessar o painel administrativo.</p>
        <a href="${escapeHtml(actionLink)}" style="display:inline-block;background:#273F4B;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700">Definir senha</a>
        <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#64748b">Se voce nao esperava este acesso, ignore este e-mail.</p>
      </div>
    </div>
  `
}

function renderUserEmailChangeValidationEmail(
  displayName: string,
  previousEmail: string,
  newEmail: string,
  actionLink: string,
): string {
  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#1f2937">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px">
        <h1 style="margin:0 0 14px;color:#273F4B;font-size:22px">Validacao de novo e-mail</h1>
        <p style="margin:0 0 12px;line-height:1.6">Ola, ${escapeHtml(displayName)}.</p>
        <p style="margin:0 0 12px;line-height:1.6">Recebemos uma solicitacao para alterar seu e-mail de acesso ao CMS.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:16px 0">
          <p style="margin:0 0 8px"><strong>Anterior:</strong> ${escapeHtml(previousEmail)}</p>
          <p style="margin:0"><strong>Novo:</strong> ${escapeHtml(newEmail)}</p>
        </div>
        <a href="${escapeHtml(actionLink)}" style="display:inline-block;background:#273F4B;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700">Validar novo e-mail</a>
        <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#64748b">Se voce nao reconhece essa alteracao, ignore este e-mail e fale com o administrador.</p>
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

async function resolveActorId(supabase: SupabaseClient, payload: JwtPayload): Promise<number> {
  const email = normalizeEmail(payload.email)
  if (!email) {
    return fallbackActorId
  }

  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (error) {
    return fallbackActorId
  }

  return parsePositiveInteger(data?.id) ?? fallbackActorId
}

async function readRequestBody(req: Request): Promise<ManageUserRequest> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body as ManageUserRequest : {}
  } catch {
    throw new RequestError('JSON invalido na requisicao.')
  }
}

function requireAuthenticatedRequest(req: Request): JwtPayload {
  const payload = decodeJwtPayload(req.headers.get('authorization'))
  const role = normalizeText(payload?.role)

  if (role !== 'authenticated') {
    throw new RequestError('Sessao autenticada obrigatoria para gerenciar usuarios.', 401)
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

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function requireEmail(value: unknown): string {
  const email = normalizeEmail(value)

  if (!email) {
    throw new RequestError('Informe um e-mail valido.')
  }

  return email
}

function getDisplayName(body: ManageUserRequest, email: string): string {
  return getOptionalDisplayName(body) ?? email.split('@')[0] ?? 'Usuario'
}

function getOptionalDisplayName(body: ManageUserRequest): string | null {
  return normalizeText(body.nome) ?? normalizeText(body.displayName)
}

function buildUserMetadata(displayName: string): Record<string, string> {
  return {
    nome: displayName,
    name: displayName,
    display_name: displayName,
  }
}

function resolveUserStatus(body: ManageUserRequest): boolean {
  if (typeof body.isActive === 'boolean') {
    return body.isActive
  }

  if (typeof body.status === 'boolean') {
    return body.status
  }

  if (typeof body.status === 'number' && Number.isFinite(body.status)) {
    return body.status > 0
  }

  if (typeof body.status === 'string') {
    const normalized = body.status.trim().toLowerCase()

    if (['active', 'ativo', 'enabled', 'habilitado', 'true', '1'].includes(normalized)) {
      return true
    }

    if (['inactive', 'inativo', 'disabled', 'desabilitado', 'false', '0'].includes(normalized)) {
      return false
    }
  }

  return true
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

function isExistingAuthUserError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase()

  return message.includes('already') ||
    message.includes('registered') ||
    message.includes('exists') ||
    message.includes('ja cadastrado') ||
    message.includes('jÃ¡ cadastrado')
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const record = error as Record<string, unknown>
  const code = typeof record['code'] === 'string' ? record['code'] : ''
  const message = extractErrorMessage(error).toLowerCase()

  return code === '23505' ||
    message.includes('duplicate key') ||
    message.includes('already exists') ||
    message.includes('ix_users_email') ||
    message.includes('users_email_key')
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

function parseAuthUserId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  return uuidPattern.test(normalized) ? normalized : null
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
      .join(' ') || 'Nao foi possivel gerenciar o usuario.'
  }

  return 'Nao foi possivel gerenciar o usuario.'
}

function extractErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const status = (error as Record<string, unknown>)['status']
  return typeof status === 'number' ? status : null
}
