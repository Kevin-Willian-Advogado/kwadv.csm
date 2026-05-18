interface BrandEmailAction {
  label: string
  url: string
}

interface BrandEmailRow {
  label: string
  value: string
}

interface BrandEmailOptions {
  title: string
  greeting?: string | null
  paragraphs?: string[]
  rows?: BrandEmailRow[]
  messageBlock?: string | null
  action?: BrandEmailAction | null
  footer?: string | null
}

const brandLogoUrl = 'https://admin.washingtonlopes.com/logos/logo-1.svg'
const brandName = 'Kevin Willian Advogado'

export function renderBrandEmail(options: BrandEmailOptions): string {
  const paragraphs = (options.paragraphs ?? [])
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => renderParagraph(paragraph))
    .join('')
  const rows = renderRows(options.rows ?? [])
  const messageBlock = options.messageBlock ? renderMessageBlock(options.messageBlock) : ''
  const action = options.action ? renderAction(options.action) : ''
  const footer = options.footer ? renderFooter(options.footer) : ''

  return `
    <div style="width:100%;box-sizing:border-box;margin:0;background:#f4f6f7;padding:28px 18px;font-family:Arial,sans-serif;color:#1f2937">
      <div style="width:100%;box-sizing:border-box;background:#ffffff;border-top:4px solid #273F4B;border-radius:12px;padding:28px">
        <div style="margin:0 0 26px">
          <img src="${brandLogoUrl}" alt="${brandName}" width="220" style="display:block;width:220px;max-width:78%;height:auto">
        </div>
        <h1 style="margin:0 0 18px;color:#273F4B;font-size:22px;line-height:1.25;font-weight:700">${escapeHtml(options.title)}</h1>
        ${options.greeting ? renderParagraph(options.greeting) : ''}
        ${paragraphs}
        ${rows}
        ${messageBlock}
        ${action}
        ${footer}
      </div>
      <p style="margin:14px 0 0;color:#7c8790;font-size:11px;line-height:1.5;text-align:center">${brandName}</p>
    </div>
  `
}

export function renderTextWithLineBreaks(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>')
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderParagraph(value: string): string {
  return `<p style="margin:0 0 14px;line-height:1.6;font-size:15px;color:#334155">${escapeHtml(value)}</p>`
}

function renderRows(rows: BrandEmailRow[]): string {
  if (rows.length === 0) {
    return ''
  }

  const content = rows
    .map((row) => `
      <tr>
        <td style="padding:9px 0;color:#64748b;font-size:13px;font-weight:700;width:120px;vertical-align:top">${escapeHtml(row.label)}</td>
        <td style="padding:9px 0;color:#1f2937;font-size:14px;line-height:1.5;vertical-align:top">${escapeHtml(row.value)}</td>
      </tr>
    `)
    .join('')

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:18px 0;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">
      ${content}
    </table>
  `
}

function renderMessageBlock(value: string): string {
  return `
    <div style="margin:18px 0;padding:16px;border-left:4px solid #273F4B;background:#f8fafc;color:#334155;font-size:14px;line-height:1.6">
      ${renderTextWithLineBreaks(value)}
    </div>
  `
}

function renderAction(action: BrandEmailAction): string {
  return `
    <div style="margin:24px 0 4px">
      <a href="${escapeHtml(action.url)}" style="display:inline-block;background:#273F4B;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-size:14px;font-weight:700">${escapeHtml(action.label)}</a>
    </div>
  `
}

function renderFooter(value: string): string {
  return `<p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#64748b">${escapeHtml(value)}</p>`
}
