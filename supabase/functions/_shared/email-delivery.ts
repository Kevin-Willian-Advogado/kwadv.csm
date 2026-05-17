export type EmailProvider = 'disabled' | 'gmail' | 'microsoft' | 'smtp' | 'resend'
export type SmtpSecurity = 'none' | 'ssl' | 'starttls'

export interface TransactionalEmailOptions {
  fromEmail: string | null
  fromName: string
  to: string[]
  cc?: string[]
  replyTo?: string | null
  subject: string
  html: string
}

export interface EmailDeliveryConfig {
  provider?: EmailProvider | null
  fromName?: string | null
  fromEmail?: string | null
  replyToEmail?: string | null
  smtpHost?: string | null
  smtpPort?: number | null
  smtpSecurity?: SmtpSecurity | null
  smtpUsername?: string | null
  smtpPasswordSecret?: string | null
  resendApiKey?: string | null
  gmailClientId?: string | null
  gmailClientSecret?: string | null
  gmailRefreshToken?: string | null
}

interface NormalizedEmailDeliveryConfig {
  provider: EmailProvider | null
  fromName: string
  fromEmail: string | null
  replyToEmail: string | null
  smtpHost: string
  smtpPort: number
  smtpSecurity: SmtpSecurity
  smtpUsername: string
  smtpPasswordSecret: string
  resendApiKey: string
  gmailClientId: string
  gmailClientSecret: string
  gmailRefreshToken: string
}

export interface TransactionalEmailResult {
  sent: boolean
  error: string | null
}

interface GmailCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
  senderEmail: string | null
}

interface SmtpProfile {
  host: string
  port: number
  security: SmtpSecurity
  username: string
  password: string
  senderEmail: string
}

export async function sendTransactionalEmail(
  options: TransactionalEmailOptions,
  config?: EmailDeliveryConfig | null,
): Promise<TransactionalEmailResult> {
  const resolvedConfig = normalizeConfig(options, config)
  const provider = resolvedConfig.provider ?? getPreferredProvider()
  let result: TransactionalEmailResult

  if (provider === 'disabled') {
    result = { sent: false, error: 'Envio de e-mails desativado.' }
  } else if (provider === 'gmail' || provider === 'microsoft' || provider === 'smtp') {
    result = await sendSmtpEmail(options, resolvedConfig, provider)
  } else if (provider === 'resend') {
    result = await sendResendEmail(options, resolvedConfig)
  } else if (hasGmailCredentials(resolvedConfig)) {
    result = await sendGmailApiEmail(options, resolvedConfig)
  } else if (hasResendCredentials(resolvedConfig)) {
    result = await sendResendEmail(options, resolvedConfig)
  } else {
    result = {
      sent: false,
      error: 'Provedor de e-mail nao configurado.',
    }
  }

  logEmailDelivery(provider ?? 'disabled', options, result)
  return result
}

export async function encryptEmailSecret(value: unknown): Promise<string> {
  const secret = normalizeText(value)
  if (!secret) {
    return ''
  }

  const key = await getEncryptionKey()
  if (!key) {
    return `plain:${encodeBase64(secret)}`
  }

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secret),
  )

  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(encrypted))}`
}

export async function decryptEmailSecret(value: unknown): Promise<string> {
  const secret = normalizeText(value)
  if (!secret) {
    return ''
  }

  if (secret.startsWith('plain:')) {
    return decodeBase64ToText(secret.slice(6))
  }

  if (!secret.startsWith('v1:')) {
    return secret
  }

  const [, ivBase64, encryptedBase64] = secret.split(':')
  const key = await getEncryptionKey()

  if (!key || !ivBase64 || !encryptedBase64) {
    return ''
  }

  try {
    const iv = base64ToBytes(ivBase64)
    const encryptedPayload = base64ToBytes(encryptedBase64)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      encryptedPayload as BufferSource,
    )

    return new TextDecoder().decode(decrypted).trim()
  } catch {
    return ''
  }
}

function normalizeConfig(
  options: TransactionalEmailOptions,
  config?: EmailDeliveryConfig | null,
): NormalizedEmailDeliveryConfig {
  return {
    provider: normalizeProvider(config?.provider),
    fromName: normalizeText(config?.fromName) ?? normalizeText(options.fromName) ?? 'KW Advocacia',
    fromEmail:
      normalizeEmail(options.fromEmail) ??
      normalizeEmail(config?.fromEmail) ??
      normalizeEmail(Deno.env.get('CONTACT_EMAIL_FROM')),
    replyToEmail: normalizeEmail(config?.replyToEmail) ?? normalizeEmail(options.replyTo),
    smtpHost: normalizeText(config?.smtpHost) ?? '',
    smtpPort: normalizePort(config?.smtpPort),
    smtpSecurity: normalizeSmtpSecurity(config?.smtpSecurity),
    smtpUsername: normalizeText(config?.smtpUsername) ?? '',
    smtpPasswordSecret: normalizeText(config?.smtpPasswordSecret) ?? '',
    resendApiKey: normalizeText(config?.resendApiKey) ?? Deno.env.get('RESEND_API_KEY')?.trim() ?? '',
    gmailClientId: normalizeText(config?.gmailClientId) ?? Deno.env.get('GMAIL_CLIENT_ID')?.trim() ?? '',
    gmailClientSecret: normalizeText(config?.gmailClientSecret) ?? Deno.env.get('GMAIL_CLIENT_SECRET')?.trim() ?? '',
    gmailRefreshToken: normalizeText(config?.gmailRefreshToken) ?? Deno.env.get('GMAIL_REFRESH_TOKEN')?.trim() ?? '',
  }
}

function getPreferredProvider(): EmailProvider | null {
  return normalizeProvider(Deno.env.get('EMAIL_PROVIDER'))
}

function normalizeProvider(value: unknown): EmailProvider | null {
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

  return null
}

function normalizeSmtpSecurity(value: unknown): SmtpSecurity {
  const security = normalizeText(value)?.toLowerCase()

  if (security === 'none' || security === 'ssl' || security === 'starttls') {
    return security
  }

  return 'starttls'
}

function normalizePort(value: unknown): number {
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

function hasGmailCredentials(config: NormalizedEmailDeliveryConfig): boolean {
  const credentials = getGmailCredentials(config)
  return Boolean(credentials.clientId && credentials.clientSecret && credentials.refreshToken)
}

function hasResendCredentials(config: NormalizedEmailDeliveryConfig): boolean {
  return Boolean(config.resendApiKey)
}

async function sendSmtpEmail(
  options: TransactionalEmailOptions,
  config: NormalizedEmailDeliveryConfig,
  provider: EmailProvider,
): Promise<TransactionalEmailResult> {
  const profile = await buildSmtpProfile(config, provider)

  if (!profile) {
    return {
      sent: false,
      error: getSmtpConfigurationError(provider),
    }
  }

  const recipients = normalizeRecipients(options.to)
  const ccRecipients = normalizeRecipients(options.cc ?? [])
  const replyTo = normalizeEmail(options.replyTo) ?? config.replyToEmail
  const senderEmail = normalizeEmail(options.fromEmail) ?? normalizeEmail(config.fromEmail)

  if (recipients.length === 0) {
    return { sent: false, error: 'Nenhum destinatario configurado.' }
  }

  if (!senderEmail) {
    return { sent: false, error: 'E-mail base de envio nao configurado.' }
  }

  let session: SmtpSession | null = null

  try {
    session = await SmtpSession.connect(profile)
    await session.sendMail({
      ...options,
      fromEmail: senderEmail,
      fromName: normalizeText(options.fromName) ?? config.fromName,
      to: recipients,
      cc: ccRecipients,
      replyTo,
    })
    await session.quit()

    return { sent: true, error: null }
  } catch (error) {
    return {
      sent: false,
      error: formatSmtpDeliveryError(error),
    }
  } finally {
    session?.close()
  }
}

async function buildSmtpProfile(
  config: NormalizedEmailDeliveryConfig,
  provider: EmailProvider,
): Promise<SmtpProfile | null> {
  const senderEmail = normalizeEmail(config.fromEmail)

  if (!senderEmail) {
    return null
  }

  const password = await decryptEmailSecret(config.smtpPasswordSecret)

  if (!password) {
    return null
  }

  if (provider === 'gmail') {
    return {
      host: 'smtp.gmail.com',
      port: 587,
      security: 'starttls',
      username: senderEmail,
      password,
      senderEmail,
    }
  }

  if (provider === 'microsoft') {
    return {
      host: 'smtp.office365.com',
      port: 587,
      security: 'starttls',
      username: senderEmail,
      password,
      senderEmail,
    }
  }

  const host = normalizeText(config.smtpHost)

  if (!host) {
    return null
  }

  return {
    host,
    port: config.smtpPort,
    security: config.smtpSecurity,
    username: config.smtpUsername || senderEmail,
    password,
    senderEmail,
  }
}

function getSmtpConfigurationError(provider: EmailProvider): string {
  if (provider === 'gmail') {
    return 'Gmail nao configurado. Informe e-mail, usuario e senha de app.'
  }

  if (provider === 'microsoft') {
    return 'Microsoft nao configurado. Informe e-mail, usuario e senha SMTP.'
  }

  return 'SMTP nao configurado. Informe servidor, porta, usuario e senha.'
}

async function sendGmailApiEmail(
  options: TransactionalEmailOptions,
  config: NormalizedEmailDeliveryConfig,
): Promise<TransactionalEmailResult> {
  const credentials = getGmailCredentials(config)

  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
    return {
      sent: false,
      error: 'Gmail API nao configurada. Informe GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET e GMAIL_REFRESH_TOKEN.',
    }
  }

  const senderEmail = normalizeEmail(options.fromEmail) ?? normalizeEmail(config.fromEmail)

  if (!senderEmail) {
    return { sent: false, error: 'E-mail base de envio nao configurado.' }
  }

  const recipients = normalizeRecipients(options.to)
  const ccRecipients = normalizeRecipients(options.cc ?? [])
  const replyTo = normalizeEmail(options.replyTo) ?? config.replyToEmail

  if (recipients.length === 0) {
    return { sent: false, error: 'Nenhum destinatario configurado.' }
  }

  const accessToken = await fetchGmailAccessToken(credentials)

  if (!accessToken.ok) {
    return { sent: false, error: accessToken.error }
  }

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: encodeBase64Url(buildMimeMessage({
        ...options,
        fromEmail: senderEmail,
        fromName: normalizeText(options.fromName) ?? config.fromName,
        to: recipients,
        cc: ccRecipients,
        replyTo,
      })),
    }),
  })

  if (!response.ok) {
    const details = await readErrorDetails(response)
    return {
      sent: false,
      error: `Falha ao enviar e-mail pelo Gmail: ${response.status} ${response.statusText}${details}`,
    }
  }

  return { sent: true, error: null }
}

async function sendResendEmail(
  options: TransactionalEmailOptions,
  config: NormalizedEmailDeliveryConfig,
): Promise<TransactionalEmailResult> {
  const apiKey = config.resendApiKey

  if (!apiKey) {
    return { sent: false, error: 'RESEND_API_KEY ausente.' }
  }

  const fromEmail = normalizeEmail(options.fromEmail) ?? normalizeEmail(config.fromEmail)
  const fromName = normalizeText(options.fromName) ?? normalizeText(config.fromName) ?? 'KW Advocacia'

  if (!fromEmail) {
    return { sent: false, error: 'E-mail base de envio nao configurado.' }
  }

  const recipients = normalizeRecipients(options.to)
  const ccRecipients = normalizeRecipients(options.cc ?? [])
  const replyTo = normalizeEmail(options.replyTo) ?? config.replyToEmail

  if (recipients.length === 0) {
    return { sent: false, error: 'Nenhum destinatario configurado.' }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: recipients,
      cc: ccRecipients.length > 0 ? ccRecipients : undefined,
      reply_to: replyTo,
      subject: options.subject,
      html: options.html,
    }),
  })

  if (!response.ok) {
    const details = await readErrorDetails(response)
    return {
      sent: false,
      error: `Falha ao enviar e-mail: ${response.status} ${response.statusText}${details}`,
    }
  }

  return { sent: true, error: null }
}

function getGmailCredentials(config: NormalizedEmailDeliveryConfig): GmailCredentials {
  return {
    clientId: config.gmailClientId,
    clientSecret: config.gmailClientSecret,
    refreshToken: config.gmailRefreshToken,
    senderEmail:
      normalizeEmail(config.fromEmail) ??
      normalizeEmail(Deno.env.get('GMAIL_SENDER_EMAIL')) ??
      normalizeEmail(Deno.env.get('GMAIL_EMAIL')) ??
      normalizeEmail(Deno.env.get('CONTACT_EMAIL_FROM')),
  }
}

async function fetchGmailAccessToken(
  credentials: GmailCredentials,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const details = await readErrorDetails(response)
    return {
      ok: false,
      error: `Falha ao autenticar no Gmail: ${response.status} ${response.statusText}${details}`,
    }
  }

  const payload = await response.json() as { access_token?: unknown }
  const token = typeof payload.access_token === 'string' ? payload.access_token.trim() : ''

  if (!token) {
    return { ok: false, error: 'Gmail nao retornou token de acesso.' }
  }

  return { ok: true, token }
}

class SmtpSession {
  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private writer: WritableStreamDefaultWriter<Uint8Array>
  private buffer = ''

  private constructor(
    private connection: Deno.TcpConn | Deno.TlsConn,
    private readonly profile: SmtpProfile,
  ) {
    this.reader = connection.readable.getReader()
    this.writer = connection.writable.getWriter()
  }

  static async connect(profile: SmtpProfile): Promise<SmtpSession> {
    const connection = profile.security === 'ssl'
      ? await Deno.connectTls({ hostname: profile.host, port: profile.port })
      : await Deno.connect({ hostname: profile.host, port: profile.port })

    const session = new SmtpSession(connection, profile)
    await session.expect([220])
    await session.ehlo()

    if (profile.security === 'starttls') {
      await session.command('STARTTLS', [220])
      await session.startTls()
      await session.ehlo()
    }

    if (profile.username || profile.password) {
      await session.authenticate()
    }

    return session
  }

  async sendMail(options: TransactionalEmailOptions): Promise<void> {
    const senderEmail = requireEmail(options.fromEmail)
    const recipients = [...normalizeRecipients(options.to), ...normalizeRecipients(options.cc ?? [])]

    await this.command(`MAIL FROM:<${senderEmail}>`, [250])

    for (const recipient of recipients) {
      await this.command(`RCPT TO:<${recipient}>`, [250, 251])
    }

    await this.command('DATA', [354])
    await this.write(`${dotStuff(buildMimeMessage(options))}\r\n.`)
    await this.expect([250])
  }

  async quit(): Promise<void> {
    await this.command('QUIT', [221])
  }

  close(): void {
    try {
      this.reader.releaseLock()
    } catch {
      // Ignore release errors while closing the SMTP socket.
    }

    try {
      this.writer.releaseLock()
    } catch {
      // Ignore release errors while closing the SMTP socket.
    }

    try {
      this.connection.close()
    } catch {
      // Ignore close errors after the request finished.
    }
  }

  private async ehlo(): Promise<void> {
    try {
      await this.command('EHLO kwadv.local', [250])
    } catch {
      await this.command('HELO kwadv.local', [250])
    }
  }

  private async authenticate(): Promise<void> {
    await this.command('AUTH LOGIN', [334])
    await this.command(encodeBase64(this.profile.username), [334])
    await this.command(encodeBase64(this.profile.password), [235])
  }

  private async startTls(): Promise<void> {
    this.reader.releaseLock()
    this.writer.releaseLock()
    this.connection = await Deno.startTls(this.connection as Deno.TcpConn, { hostname: this.profile.host })
    this.reader = this.connection.readable.getReader()
    this.writer = this.connection.writable.getWriter()
    this.buffer = ''
  }

  private async command(command: string, expectedCodes: number[]): Promise<void> {
    await this.write(command)
    await this.expect(expectedCodes)
  }

  private async write(command: string): Promise<void> {
    await this.writer.write(this.encoder.encode(`${command}\r\n`))
  }

  private async expect(expectedCodes: number[]): Promise<void> {
    const response = await this.readResponse()

    if (!expectedCodes.includes(response.code)) {
      throw new Error(`${response.code} ${response.message}`)
    }
  }

  private async readResponse(): Promise<{ code: number; message: string }> {
    const lines: string[] = []

    while (true) {
      const line = await this.readLine()
      lines.push(line)

      const code = Number(line.slice(0, 3))
      const isLastLine = /^\d{3}\s/.test(line)

      if (Number.isInteger(code) && isLastLine) {
        return {
          code,
          message: lines.join(' '),
        }
      }
    }
  }

  private async readLine(): Promise<string> {
    while (!this.buffer.includes('\n')) {
      const chunk = await this.reader.read()

      if (chunk.done) {
        throw new Error('Conexao SMTP encerrada pelo servidor.')
      }

      this.buffer += this.decoder.decode(chunk.value, { stream: true })
    }

    const lineBreakIndex = this.buffer.indexOf('\n')
    const line = this.buffer.slice(0, lineBreakIndex).replace(/\r$/, '')
    this.buffer = this.buffer.slice(lineBreakIndex + 1)
    return line
  }
}

function buildMimeMessage(options: TransactionalEmailOptions): string {
  const headers = [
    `From: ${formatEmailAddress(requireEmail(options.fromEmail), options.fromName)}`,
    `To: ${formatEmailAddressList(options.to)}`,
    ...buildOptionalHeader('Cc', formatEmailAddressList(options.cc ?? [])),
    ...buildOptionalHeader('Reply-To', formatEmailAddressList(options.replyTo ? [options.replyTo] : [])),
    `Subject: ${encodeMimeHeader(options.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ]

  return `${headers.join('\r\n')}\r\n\r\n${wrapBase64(encodeBase64(options.html))}`
}

function dotStuff(value: string): string {
  return value
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map((line) => line.startsWith('.') ? `.${line}` : line)
    .join('\r\n')
}

function buildOptionalHeader(name: string, value: string): string[] {
  return value ? [`${name}: ${value}`] : []
}

function formatEmailAddressList(emails: string[]): string {
  return normalizeRecipients(emails)
    .map((email) => formatEmailAddress(email))
    .join(', ')
}

function formatEmailAddress(email: string, name?: string | null): string {
  const normalizedEmail = requireEmail(email)
  const normalizedName = sanitizeHeader(name ?? '')

  if (!normalizedName) {
    return `<${normalizedEmail}>`
  }

  return `${encodeMimeHeader(normalizedName)} <${normalizedEmail}>`
}

function encodeMimeHeader(value: string): string {
  return `=?UTF-8?B?${encodeBase64(sanitizeHeader(value))}?=`
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

function requireEmail(value: unknown): string {
  const email = normalizeEmail(value)

  if (!email) {
    throw new Error('Informe um e-mail valido.')
  }

  return email
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

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

async function getEncryptionKey(): Promise<CryptoKey | null> {
  const secret = Deno.env.get('EMAIL_CONFIG_ENCRYPTION_KEY')?.trim()

  if (!secret) {
    return null
  }

  const digest = await crypto.subtle.digest('SHA-256', textOrBase64ToBytes(secret) as BufferSource)

  return await crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

function textOrBase64ToBytes(value: string): Uint8Array {
  try {
    const bytes = base64ToBytes(value)
    if (bytes.length > 0) {
      return bytes
    }
  } catch {
    // Fall back to the raw secret text.
  }

  return new TextEncoder().encode(value)
}

function encodeBase64Url(value: string): string {
  return encodeBase64(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function encodeBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value))
}

function decodeBase64ToText(value: string): string {
  return new TextDecoder().decode(base64ToBytes(value)).trim()
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join('\r\n') ?? value
}

function logEmailDelivery(
  provider: EmailProvider,
  options: TransactionalEmailOptions,
  result: TransactionalEmailResult,
): void {
  const details = {
    provider,
    subject: sanitizeHeader(options.subject).slice(0, 120),
    toCount: normalizeRecipients(options.to).length,
    ccCount: normalizeRecipients(options.cc ?? []).length,
    sent: result.sent,
  }

  if (result.sent) {
    console.info('email_delivery_success', details)
    return
  }

  console.warn('email_delivery_failure', {
    ...details,
    error: result.error,
  })
}

export function formatSmtpDeliveryError(error: unknown): string {
  const technicalMessage = extractErrorMessage(error)
  const friendlyMessage = getFriendlySmtpErrorMessage(technicalMessage)

  if (!friendlyMessage) {
    return `Falha ao enviar e-mail por SMTP: ${technicalMessage}`
  }

  return `Falha ao enviar e-mail por SMTP: ${friendlyMessage} Detalhe tecnico: ${technicalMessage}`
}

export function getFriendlySmtpErrorMessage(message: string): string | null {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('535') ||
    normalized.includes('5.7.8') ||
    normalized.includes('username and password not accepted') ||
    normalized.includes('authentication unsuccessful')
  ) {
    return 'credenciais recusadas. Confira o e-mail, o usuario e a senha de app/senha SMTP configurada.'
  }

  if (
    normalized.includes('534') ||
    normalized.includes('application-specific password') ||
    normalized.includes('application specific password')
  ) {
    return 'o provedor bloqueou a autenticacao por senha comum. No Gmail, gere e use uma senha de app.'
  }

  if (
    normalized.includes('5.7.3') ||
    normalized.includes('smtp auth') ||
    normalized.includes('authenticated smtp')
  ) {
    return 'a autenticacao SMTP foi recusada. No Microsoft 365, confirme se SMTP autenticado esta liberado para a conta ou tenant.'
  }

  if (
    normalized.includes('certificate') ||
    normalized.includes('tls') ||
    normalized.includes('starttls')
  ) {
    return 'falha na negociacao de seguranca SMTP. Confira porta e modo de seguranca.'
  }

  return null
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  return 'erro desconhecido'
}

async function readErrorDetails(response: Response): Promise<string> {
  try {
    const body = (await response.text()).trim()
    if (!body) {
      return ''
    }

    const maxLength = 240
    return ` - ${body.length > maxLength ? `${body.slice(0, maxLength)}...` : body}`
  } catch {
    return ''
  }
}
