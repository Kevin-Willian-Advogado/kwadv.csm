type ArticlePublicationAction = 'publish' | 'unpublish'

interface PublishArticleRequest {
  articleId?: number | string | null
  articleSlug?: string | null
  slug?: string | null
  action?: ArticlePublicationAction | null
  actorId?: number | string | null
  updatedAt?: string | null
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

const defaultGithubOwner = 'Kevin-Willian-Advogado'
const defaultGithubRepo = 'kwadv.page'
const defaultWorkflowId = 'deploy-pages.yml'
const defaultWorkflowRef = 'main'

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
    const articleId = requirePositiveInteger(body.articleId)
    const articleSlug = normalizeText(body.articleSlug) ?? normalizeText(body.slug) ?? ''
    const action = normalizePublicationAction(body.action)
    const actorId = parsePositiveInteger(body.actorId)
    const updatedAt = normalizeText(body.updatedAt) ?? ''
    const githubConfig = getGithubConfig()

    await dispatchGithubWorkflow(githubConfig, {
      articleId,
      articleSlug,
      action,
      actorId,
      updatedAt,
    })

    return jsonResponse({
      mensagem: 'Action de publicacao acionada com sucesso.',
      data: {
        articleId,
        articleSlug,
        action,
        workflow: githubConfig.workflowId,
        ref: githubConfig.ref,
      },
    })
  } catch (error) {
    const message = extractErrorMessage(error)
    const status = error instanceof RequestError ? error.status : 400

    return jsonResponse({ error: message, erro: message, message }, status)
  }
})

interface GithubConfig {
  token: string
  owner: string
  repo: string
  workflowId: string
  ref: string
}

interface GithubDispatchPayload {
  articleId: number
  articleSlug: string
  action: ArticlePublicationAction
  actorId: number | null
  updatedAt: string
}

function getGithubConfig(): GithubConfig {
  const token = Deno.env.get('GITHUB_TOKEN')?.trim() ?? ''

  if (!token) {
    throw new RequestError('Variavel GITHUB_TOKEN e obrigatoria para acionar a Action.', 500)
  }

  return {
    token,
    owner: Deno.env.get('GITHUB_OWNER')?.trim() || defaultGithubOwner,
    repo: Deno.env.get('GITHUB_REPO')?.trim() || defaultGithubRepo,
    workflowId: Deno.env.get('GITHUB_WORKFLOW_ID')?.trim() || defaultWorkflowId,
    ref: Deno.env.get('GITHUB_REF')?.trim() || defaultWorkflowRef,
  }
}

async function dispatchGithubWorkflow(
  config: GithubConfig,
  payload: GithubDispatchPayload,
): Promise<void> {
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/workflows/${encodeURIComponent(config.workflowId)}/dispatches`,
  )

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'kwadv-csm-publication-dispatcher',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      ref: config.ref,
      inputs: {
        article_id: String(payload.articleId),
        article_slug: payload.articleSlug,
        article_updated_at: payload.updatedAt,
        publication_action: payload.action,
        actor_id: payload.actorId === null ? '' : String(payload.actorId),
      },
    }),
  })

  if (!response.ok) {
    const details = await readErrorDetails(response)
    throw new RequestError(
      `Nao foi possivel acionar a Action do GitHub: ${response.status} ${response.statusText}${details}`,
      502,
    )
  }
}

async function readRequestBody(req: Request): Promise<PublishArticleRequest> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body as PublishArticleRequest : {}
  } catch {
    throw new RequestError('JSON invalido na requisicao.')
  }
}

function requirePositiveInteger(value: unknown): number {
  const parsed = parsePositiveInteger(value)

  if (parsed === null) {
    throw new RequestError('Informe um articleId valido.')
  }

  return parsed
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  return null
}

function normalizePublicationAction(value: unknown): ArticlePublicationAction {
  if (value === 'unpublish') {
    return 'unpublish'
  }

  return 'publish'
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized || null
}

async function readErrorDetails(response: Response): Promise<string> {
  try {
    const body = (await response.text()).trim()
    if (!body) {
      return ''
    }

    const maxLength = 300
    const details = body.length > maxLength ? `${body.slice(0, maxLength)}...` : body
    return ` - ${details}`
  } catch {
    return ''
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
      .join(' ') || 'Nao foi possivel acionar a publicacao.'
  }

  return 'Nao foi possivel acionar a publicacao.'
}
