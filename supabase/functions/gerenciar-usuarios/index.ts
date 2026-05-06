import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

type UserAction = 'create' | 'edit' | 'delete'

interface ManageUserRequest {
  acao?: UserAction
  id?: string | number | null
  authUserId?: string | null
  actorId?: string | number | null
  createdBy?: string | number | null
  updatedBy?: string | number | null
  email?: string | null
  currentEmail?: string | null
  previousEmail?: string | null
  password?: string | null
  nome?: string | null
  displayName?: string | null
  status?: boolean | number | string | null
  isActive?: boolean | null
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
const publicUserBaseSelect = 'id,email,password_hash,created_at,created_by,updated_at,updated_by'
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
    const body = await readRequestBody(req)
    const supabase = createAdminClient()

    if (body.acao === 'create') {
      return await createAuthUser(supabase, body)
    }

    if (body.acao === 'edit') {
      return await editAuthUser(supabase, body)
    }

    if (body.acao === 'delete') {
      return await deleteAuthUser(supabase, body)
    }

    throw new RequestError("Acao invalida. Envie 'create', 'edit' ou 'delete'.")
  } catch (error) {
    const message = extractErrorMessage(error)
    const status = error instanceof RequestError ? error.status : extractErrorStatus(error) ?? 400

    return jsonResponse({ error: message, erro: message, message }, status)
  }
})

async function createAuthUser(supabase: SupabaseClient, body: ManageUserRequest): Promise<Response> {
  const email = requireEmail(body.email)
  const password = requirePassword(body.password)
  const displayName = getDisplayName(body, email)

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: buildUserMetadata(displayName),
  })

  if (error && !isExistingAuthUserError(error)) {
    throw error
  }

  const existingAuthUser = error ? await findAuthUserByEmail(supabase, email) : null
  const publicUser = await createPublicUser(supabase, body, email, displayName)

  return jsonResponse({
    mensagem: 'Usuario criado com sucesso.',
    data: {
      authUser: {
        id: data?.user?.id ?? existingAuthUser?.id ?? null,
        email: data?.user?.email ?? existingAuthUser?.email ?? email,
      },
      publicUser,
    },
  })
}

async function createPublicUser(
  supabase: SupabaseClient,
  body: ManageUserRequest,
  email: string,
  displayName: string,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString()
  const actorId = resolveActorId(body)
  const payload: Record<string, unknown> = {
    email,
    name: displayName,
    status: resolveUserStatus(body),
    password_hash: passwordHashMarker,
    created_at: now,
    created_by: actorId,
    updated_at: now,
    updated_by: actorId,
  }

  return await insertPublicUser(supabase, payload, true)
}

async function insertPublicUser(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  includeProfileFields: boolean,
): Promise<Record<string, unknown>> {
  const email = normalizeEmail(payload['email'])
  if (!email) {
    throw new RequestError('Informe um e-mail valido para criar o usuario na tabela users.')
  }

  const { data, error } = await supabase
    .from('users')
    .insert(payload)
    .select(includeProfileFields ? publicUserProfileSelect : publicUserBaseSelect)
    .single()

  if (error) {
    if (includeProfileFields && isSchemaCacheColumnError(error)) {
      const fallbackPayload = { ...payload }
      delete fallbackPayload['name']
      delete fallbackPayload['status']

      return await insertPublicUser(supabase, fallbackPayload, false)
    }

    if (isUniqueConstraintError(error)) {
      const existingUser = await findPublicUserByEmail(supabase, email)

      if (existingUser) {
        return existingUser
      }
    }

    throw error
  }

  if (!data) {
    throw new RequestError('A tabela users nao retornou o usuario criado.', 500)
  }

  return data
}

async function findPublicUserByEmail(
  supabase: SupabaseClient,
  email: string,
  includeProfileFields = true,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('users')
    .select(includeProfileFields ? publicUserProfileSelect : publicUserBaseSelect)
    .eq('email', email)
    .maybeSingle()

  if (error) {
    if (includeProfileFields && isSchemaCacheColumnError(error)) {
      return await findPublicUserByEmail(supabase, email, false)
    }

    throw error
  }

  return data
}

async function editAuthUser(supabase: SupabaseClient, body: ManageUserRequest): Promise<Response> {
  const authUserId = await resolveAuthUserId(supabase, body)
  const email = normalizeEmail(body.email)
  const password = normalizePassword(body.password)
  const displayName = getOptionalDisplayName(body)
  const updates: Record<string, unknown> = {}

  if (email) {
    updates['email'] = email
    updates['email_confirm'] = true
  }

  if (password) {
    updates['password'] = password
  }

  if (displayName) {
    updates['user_metadata'] = buildUserMetadata(displayName)
  }

  if (Object.keys(updates).length === 0) {
    throw new RequestError('Nenhuma alteracao enviada para o Auth.')
  }

  const { data, error } = await supabase.auth.admin.updateUserById(authUserId, updates)

  if (error) {
    throw error
  }

  return jsonResponse({
    mensagem: 'Usuario atualizado com sucesso.',
    data: {
      id: data.user?.id ?? authUserId,
      email: data.user?.email ?? email,
    },
  })
}

async function deleteAuthUser(supabase: SupabaseClient, body: ManageUserRequest): Promise<Response> {
  const authUserId = await resolveAuthUserId(supabase, body, false)

  if (!authUserId) {
    return jsonResponse({
      mensagem: 'Nenhum usuario do Auth encontrado para excluir.',
      data: null,
    })
  }

  const { error } = await supabase.auth.admin.deleteUser(authUserId)

  if (error) {
    throw error
  }

  return jsonResponse({
    mensagem: 'Usuario excluido do Auth com sucesso.',
    data: { id: authUserId },
  })
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
    throw new RequestError('Usuario do Auth nao encontrado para atualizar.', 404)
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

async function readRequestBody(req: Request): Promise<ManageUserRequest> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body as ManageUserRequest : {}
  } catch {
    throw new RequestError('JSON invalido na requisicao.')
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

function requirePassword(value: unknown): string {
  const password = normalizePassword(value)

  if (!password) {
    throw new RequestError('Informe uma senha com pelo menos 6 caracteres.')
  }

  return password
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const password = value.trim()

  if (!password) {
    return null
  }

  if (password.length < 6) {
    throw new RequestError('Informe uma senha com pelo menos 6 caracteres.')
  }

  return password
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

function resolveActorId(body: ManageUserRequest): number {
  return parseInteger(body.actorId) ??
    parseInteger(body.createdBy) ??
    parseInteger(body.updatedBy) ??
    fallbackActorId
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

function parseInteger(value: unknown): number | null {
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
    message.includes('já cadastrado')
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
    message.includes('ix_users_email')
}

function isSchemaCacheColumnError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase()

  return message.includes('schema cache') ||
    message.includes('could not find') ||
    message.includes('column') && (message.includes('name') || message.includes('status'))
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()
  return normalized.includes('@') ? normalized : null
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
