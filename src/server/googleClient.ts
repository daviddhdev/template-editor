// Server-only Google OAuth and Drive helpers. Keep the import dynamic in handlers.

import { randomBytes } from 'node:crypto'
import { uniqueName } from '../lib/uniqueNames'
import { domainAllowed } from './authHelpers'
import { readDotEnv } from './env'

// drive.file handles app-created temporary Docs; full drive is needed for
// uploads into a user-selected folder.
const READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const FULL_SCOPE = 'https://www.googleapis.com/auth/drive'
const SCOPES = `${FULL_SCOPE} openid email`
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const DOCS_API = 'https://docs.googleapis.com/v1/documents'

export class GoogleError extends Error {
  hint?: string
  code?: 'FOLDER_GONE' | 'NATIVE_STYLE_MISMATCH'
  constructor(message: string, hint?: string, code?: 'FOLDER_GONE' | 'NATIVE_STYLE_MISMATCH') {
    super(message)
    this.hint = hint
    this.code = code
  }
}


interface GoogleConfig {
  clientId: string
  clientSecret: string
}

let cachedConfig: GoogleConfig | null | undefined

export function loadConfig(): GoogleConfig | null {
  if (cachedConfig !== undefined) return cachedConfig
  const env = { ...readDotEnv(), ...process.env }
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  cachedConfig = clientId && clientSecret ? { clientId, clientSecret } : null
  return cachedConfig
}

let cachedApiKey: string | null | undefined

export function loadApiKey(): string | null {
  if (cachedApiKey !== undefined) return cachedApiKey
  const env = { ...readDotEnv(), ...process.env }
  cachedApiKey = env.GOOGLE_API_KEY?.trim() || null
  return cachedApiKey
}

function requireConfig(): GoogleConfig {
  const cfg = loadConfig()
  if (!cfg) {
    throw new GoogleError(
      'Faltan las credenciales de Google (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).',
      'Crea un cliente OAuth en Google Cloud Console y copia sus claves al archivo .env (mira .env.example).',
    )
  }
  return cfg
}

function allowedDomain(): string | undefined {
  const env = { ...readDotEnv(), ...process.env }
  return env.ALLOWED_GOOGLE_HD?.trim() || undefined
}


const pendingStates = new Map<string, { redirectUri: string; expiresAt: number }>()

function redirectUriFor(origin: string): string {
  return `${origin.replace(/\/$/, '')}/oauth/callback`
}

export function buildAuthUrl(origin: string): string {
  const cfg = requireConfig()
  const state = randomBytes(16).toString('hex')
  const redirectUri = redirectUriFor(origin)
  pendingStates.set(state, { redirectUri, expiresAt: Date.now() + 10 * 60_000 })
  for (const [k, v] of pendingStates) if (v.expiresAt < Date.now()) pendingStates.delete(k)

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  const hd = allowedDomain()
  if (hd) params.set('hd', hd)
  return `${AUTH_ENDPOINT}?${params}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token?: string
  scope?: string
  error?: string
  error_description?: string
}

function claimsFromIdToken(idToken: string | undefined): {
  email: string | null
  emailVerified: boolean | undefined
  hd: string | undefined
} {
  if (!idToken) return { email: null, emailVerified: undefined, hd: undefined }
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'))
    return {
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: typeof payload.email_verified === 'boolean' ? payload.email_verified : undefined,
      hd: typeof payload.hd === 'string' ? payload.hd : undefined,
    }
  } catch {
    return { email: null, emailVerified: undefined, hd: undefined }
  }
}

export interface ExchangedTokens {
  email: string
  refreshToken: string
  accessToken: string
  expiresAt: number
  scopes: string
}

async function revokeToken(token: string): Promise<void> {
  await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
  }).catch(() => {})
}

export async function exchangeCode(code: string, state: string): Promise<ExchangedTokens> {
  const cfg = requireConfig()
  const pending = pendingStates.get(state)
  if (!pending || pending.expiresAt < Date.now()) {
    throw new GoogleError(
      'La entrada con Google caducó o no se inició desde esta aplicación.',
      'Vuelve a pulsar "Entrar con Google" e inténtalo de nuevo.',
    )
  }
  pendingStates.delete(state)

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: pending.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const data = (await res.json()) as TokenResponse
  if (!res.ok || !data.access_token || !data.refresh_token) {
    throw new GoogleError(
      'Google no aceptó la conexión.',
      data.error_description ?? data.error ?? 'Inténtalo de nuevo.',
    )
  }

  const { email, emailVerified, hd } = claimsFromIdToken(data.id_token)
  if (!email) {
    await revokeToken(data.refresh_token)
    throw new GoogleError(
      'Google no devolvió la identidad de la cuenta.',
      'Inténtalo de nuevo; si persiste, revisa que el scope "email" esté permitido en Google Cloud Console.',
    )
  }
  const allowed = allowedDomain()
  if (!allowed) {
    console.warn(
      'ALLOWED_GOOGLE_HD no está definido: cualquier cuenta de Google puede entrar (solo aceptable en desarrollo).',
    )
  }
  if (!domainAllowed(email, hd, emailVerified, allowed)) {
    await revokeToken(data.refresh_token)
    throw new GoogleError(
      `Esta aplicación es solo para cuentas de ${allowed}.`,
      'Entra con tu cuenta de Google del trabajo.',
    )
  }

  return {
    email,
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    scopes: data.scope ?? '',
  }
}

export interface GoogleStatus {
  configured: boolean
  connected: boolean
  canRead: boolean
  canWrite: boolean
  pickerConfigured: boolean
  email: string | null
}

export async function getStatusForUser(userId: string): Promise<GoogleStatus> {
  const { readGoogleTokens } = await import('./usersDb')
  const tokens = await readGoogleTokens(userId)
  // Match complete scopes; FULL_SCOPE prefixes drive.file and drive.readonly.
  const granted = new Set(tokens?.scopes.split(/\s+/) ?? [])
  const connected = tokens?.refreshToken != null
  return {
    configured: loadConfig() !== null,
    connected,
    canRead: connected && (granted.has(READ_SCOPE) || granted.has(FULL_SCOPE)),
    canWrite: connected && granted.has(FULL_SCOPE),
    pickerConfigured: loadApiKey() !== null,
    email: null, // the session, not the Google connection, names the user now
  }
}

const RECONNECT = new GoogleError(
  'La conexión con Google ya no es válida.',
  'Vuelve a conectar tu cuenta de Google desde la barra superior.',
)

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>()
const pendingRefresh = new Map<string, Promise<string>>()

export async function getAccessToken(userId: string): Promise<string> {
  const cached = tokenCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken

  const pending = pendingRefresh.get(userId)
  if (pending) return pending

  const job = (async () => {
    const cfg = requireConfig()
    const { readGoogleTokens, saveAccessToken, clearGoogleTokens } = await import('./usersDb')
    const tokens = await readGoogleTokens(userId)
    if (!tokens?.refreshToken) throw RECONNECT
    if (tokens.accessToken && tokens.expiresAt && tokens.expiresAt > Date.now()) {
      tokenCache.set(userId, { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt })
      return tokens.accessToken
    }

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: tokens.refreshToken,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'refresh_token',
      }),
    })
    const data = (await res.json()) as TokenResponse
    if (!res.ok || !data.access_token) {
      await clearGoogleTokens(userId)
      tokenCache.delete(userId)
      throw RECONNECT
    }
    const expiresAt = Date.now() + (data.expires_in - 60) * 1000
    await saveAccessToken(userId, data.access_token, expiresAt)
    tokenCache.set(userId, { accessToken: data.access_token, expiresAt })
    return data.access_token
  })()

  pendingRefresh.set(userId, job)
  try {
    return await job
  } finally {
    pendingRefresh.delete(userId)
  }
}


async function driveError(res: Response, fallback: string): Promise<GoogleError> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } }
    detail = body.error?.message ?? ''
  } catch {
  }
  if (res.status === 401) return RECONNECT
  if (res.status === 403) {
    if (detail.includes('has not been used') || detail.includes('is disabled')) {
      const api = detail.includes('sheets.googleapis.com')
        ? 'Google Sheets API'
        : detail.includes('docs.googleapis.com')
          ? 'Google Docs API'
          : 'Google Drive API'
      return new GoogleError(fallback, `Activa la "${api}" en tu proyecto de Google Cloud Console.`)
    }
    if (detail.includes('storageQuotaExceeded') || detail.includes('storage quota')) {
      return new GoogleError(
        'Tu Drive no tiene espacio libre.',
        'Libera espacio o vacía la papelera de Google Drive e inténtalo de nuevo.',
      )
    }
    if (detail.toLowerCase().includes('insufficient') || detail.includes('SCOPE')) {
      return new GoogleError(
        'Tu conexión de Google no tiene los permisos necesarios.',
        'Desconecta y vuelve a conectar tu cuenta de Google para concederlos.',
      )
    }
    return new GoogleError(fallback, detail || undefined)
  }
  if (res.status === 404) {
    return new GoogleError(
      'Tu cuenta de Google conectada no tiene acceso a ese archivo (o el enlace no existe).',
      'Compártelo con la cuenta conectada, conéctate con la cuenta correcta, o hazlo público.',
    )
  }
  return new GoogleError(fallback, detail || `Error ${res.status} de Google.`)
}

// Buffer.concat is required here; string concatenation would corrupt DOCX bytes.
export async function uploadAsGoogleDoc(
  token: string,
  name: string,
  content: Uint8Array | string,
  contentType: string,
): Promise<string> {
  const boundary = `ttg${randomBytes(12).toString('hex')}`
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify({ name, mimeType: 'application/vnd.google-apps.document' })}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  const tail = `\r\n--${boundary}--`
  const body = Buffer.concat([
    Buffer.from(head, 'utf8'),
    typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content),
    Buffer.from(tail, 'utf8'),
  ])

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!res.ok) throw await driveError(res, 'Google no pudo importar el documento.')
  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new GoogleError('Google no devolvió el documento importado.')
  return data.id
}

export async function uploadHtmlAsDoc(token: string, name: string, html: string): Promise<string> {
  return uploadAsGoogleDoc(token, name, html, 'text/html; charset=UTF-8')
}

export async function getFileMeta(
  token: string,
  fileId: string,
): Promise<{ name: string; mimeType: string }> {
  const res = await fetch(`${DRIVE_FILES}/${fileId}?fields=name,mimeType`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw await driveError(res, 'Google no pudo leer el archivo original.')
  const data = (await res.json()) as { name?: string; mimeType?: string }
  return { name: data.name ?? 'documento', mimeType: data.mimeType ?? '' }
}

export async function downloadFileBytes(token: string, fileId: string): Promise<Uint8Array> {
  const res = await fetch(`${DRIVE_FILES}/${fileId}?alt=media`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw await driveError(res, 'Google no pudo descargar el archivo original.')
  return new Uint8Array(await res.arrayBuffer())
}

export async function replaceAllTextInDoc(
  token: string,
  docId: string,
  replacements: { find: string; replace: string }[],
): Promise<{ find: string; occurrences: number }[]> {
  if (replacements.length === 0) return []
  const res = await fetch(`${DOCS_API}/${docId}:batchUpdate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      requests: replacements.map((r) => ({
        replaceAllText: {
          containsText: { text: r.find, matchCase: true },
          replaceText: r.replace,
        },
      })),
    }),
  })
  if (!res.ok) throw await driveError(res, 'Google no pudo sustituir los datos en el documento.')
  const data = (await res.json()) as {
    replies?: { replaceAllText?: { occurrencesChanged?: number } }[]
  }
  return replacements.map((r, i) => ({
    find: r.find,
    occurrences: data.replies?.[i]?.replaceAllText?.occurrencesChanged ?? 0,
  }))
}

interface DocsTextChunk {
  startIndex: number
  content: string
}

interface DocsTextSegment {
  segmentId?: string
  tabId?: string
  order: number
  chunks: DocsTextChunk[]
}

type DocsElement = {
  startIndex?: number
  paragraph?: { elements?: { startIndex?: number; textRun?: { content?: string } }[] }
  table?: { tableRows?: { tableCells?: { content?: DocsElement[] }[] }[] }
  tableOfContents?: { content?: DocsElement[] }
}

function collectChunks(elements: DocsElement[] | undefined, out: DocsTextChunk[]): void {
  for (const element of elements ?? []) {
    for (const inline of element.paragraph?.elements ?? []) {
      const content = inline.textRun?.content
      if (content !== undefined && inline.startIndex !== undefined) out.push({ startIndex: inline.startIndex, content })
    }
    for (const row of element.table?.tableRows ?? []) {
      for (const cell of row.tableCells ?? []) collectChunks(cell.content, out)
    }
    collectChunks(element.tableOfContents?.content, out)
  }
}

export function docsTextSegments(document: unknown): DocsTextSegment[] {
  const doc = document as {
    body?: { content?: DocsElement[] }
    headers?: Record<string, { content?: DocsElement[] }>
    footers?: Record<string, { content?: DocsElement[] }>
    footnotes?: Record<string, { content?: DocsElement[] }>
    tabs?: { tabProperties?: { tabId?: string }; documentTab?: unknown }[]
  }
  const segments: DocsTextSegment[] = []
  let order = 0
  const addDocument = (part: typeof doc, tabId?: string) => {
    const add = (content: DocsElement[] | undefined, segmentId?: string) => {
      const chunks: DocsTextChunk[] = []
      collectChunks(content, chunks)
      if (chunks.length) segments.push({ segmentId, tabId, order: order++, chunks })
    }
    add(part.body?.content)
    for (const [id, value] of Object.entries(part.headers ?? {}).sort()) add(value.content, id)
    for (const [id, value] of Object.entries(part.footers ?? {}).sort()) add(value.content, id)
    for (const [id, value] of Object.entries(part.footnotes ?? {}).sort()) add(value.content, id)
  }
  if (doc.tabs?.length) {
    for (const tab of doc.tabs) addDocument(tab.documentTab as typeof doc, tab.tabProperties?.tabId)
  } else addDocument(doc)
  return segments
}

export interface DocsStyleRange {
  tag: string
  startIndex: number
  endIndex: number
  segmentId?: string
  tabId?: string
  fontSizePt?: number
  colorHex?: string
}

export function locateFieldStyleRanges(
  document: unknown,
  styles: { tag: string; occurrence: number; fontSizePt?: number; colorHex?: string }[],
  replacements: { tag: string; finds: string[] }[],
): DocsStyleRange[] | null {
  const findsByTag = new Map(replacements.map((r) => [r.tag, [...new Set(r.finds)].sort((a, b) => b.length - a.length)]))
  const segments = docsTextSegments(document)
  const ranges: DocsStyleRange[] = []
  for (const style of styles) {
    const finds = findsByTag.get(style.tag) ?? []
    const matches: { startIndex: number; endIndex: number; segmentId?: string; tabId?: string; order: number }[] = []
    for (const segment of segments) {
      const chunks = [...segment.chunks].sort((a, b) => a.startIndex - b.startIndex)
      let groupStart = -1
      let groupText = ''
      let groupEnd = -1
      const scan = () => {
        for (const find of finds) {
          let from = 0
          while (from <= groupText.length - find.length) {
            const at = groupText.indexOf(find, from)
            if (at < 0) break
            matches.push({ startIndex: groupStart + at, endIndex: groupStart + at + find.length, segmentId: segment.segmentId, tabId: segment.tabId, order: segment.order })
            from = at + find.length
          }
        }
      }
      for (const chunk of chunks) {
        if (groupStart < 0 || chunk.startIndex !== groupEnd) {
          if (groupStart >= 0) scan()
          groupStart = chunk.startIndex
          groupText = chunk.content
        } else groupText += chunk.content
        groupEnd = chunk.startIndex + chunk.content.length
      }
      if (groupStart >= 0) scan()
    }
    matches.sort((a, b) => a.order - b.order || a.startIndex - b.startIndex)
    const unique = matches.filter((match, i) => i === 0 || match.order !== matches[i - 1].order || match.startIndex !== matches[i - 1].startIndex)
    const target = unique[style.occurrence]
    if (!target) return null
    ranges.push({
      tag: style.tag,
      startIndex: target.startIndex,
      endIndex: target.endIndex,
      segmentId: target.segmentId,
      tabId: target.tabId,
      fontSizePt: style.fontSizePt,
      colorHex: style.colorHex,
    })
  }
  return ranges
}

export async function applyFieldStylesInDoc(
  token: string,
  docId: string,
  styles: { tag: string; occurrence: number; fontSizePt?: number; colorHex?: string }[],
  replacements: { tag: string; finds: string[] }[],
): Promise<void> {
  const get = await fetch(`${DOCS_API}/${docId}?includeTabsContent=true`, { headers: { authorization: `Bearer ${token}` } })
  if (!get.ok) throw await driveError(get, 'Google no pudo localizar los campos para aplicar su formato.')
  const ranges = locateFieldStyleRanges(await get.json(), styles, replacements)
  if (!ranges) {
    throw new GoogleError(
      'No se pudo identificar con seguridad una aparición de campo en el documento original.',
      'El original puede haber cambiado. Reintenta este documento con la conversión HTML para conservar el tamaño y el color elegidos.',
      'NATIVE_STYLE_MISMATCH',
    )
  }
  const requests = ranges.map((range) => {
    const textStyle: Record<string, unknown> = {}
    const fields: string[] = []
    if (range.fontSizePt !== undefined) {
      textStyle.fontSize = { magnitude: range.fontSizePt, unit: 'PT' }
      fields.push('fontSize')
    }
    if (range.colorHex) {
      const n = Number.parseInt(range.colorHex.slice(1), 16)
      textStyle.foregroundColor = { color: { rgbColor: { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 } } }
      fields.push('foregroundColor')
    }
    return { updateTextStyle: { range: { startIndex: range.startIndex, endIndex: range.endIndex, ...(range.segmentId ? { segmentId: range.segmentId } : {}), ...(range.tabId ? { tabId: range.tabId } : {}) }, textStyle, fields: fields.join(',') } }
  })
  const update = await fetch(`${DOCS_API}/${docId}:batchUpdate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ requests }),
  })
  if (!update.ok) throw await driveError(update, 'Google no pudo aplicar el formato de los campos.')
}

export async function exportFile(
  token: string,
  fileId: string,
  mimeType: string,
  errorMessage = 'Google no pudo exportar el archivo.',
): Promise<Uint8Array> {
  const res = await fetch(
    `${DRIVE_FILES}/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw await driveError(res, errorMessage)
  return new Uint8Array(await res.arrayBuffer())
}


export async function fileName(token: string, fileId: string): Promise<string | null> {
  const res = await fetch(`${DRIVE_FILES}/${fileId}?fields=name`, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null)
  if (!res?.ok) return null
  const data = (await res.json().catch(() => null)) as { name?: string } | null
  return data?.name ?? null
}

export async function deleteFile(token: string, fileId: string): Promise<void> {
  await fetch(`${DRIVE_FILES}/${fileId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => {})
}


const FOLDER_MIME = 'application/vnd.google-apps.folder'

export async function createFolder(
  token: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const res = await fetch(`${DRIVE_FILES}?fields=id`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  })
  if (!res.ok) throw await driveError(res, 'Google no pudo crear la carpeta en Drive.')
  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new GoogleError('Google no devolvió la carpeta creada.')
  return data.id
}

export async function folderAlive(token: string, folderId: string): Promise<boolean> {
  const res = await fetch(`${DRIVE_FILES}/${folderId}?fields=id,trashed`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return false
  if (!res.ok) throw await driveError(res, 'Google no pudo comprobar la carpeta de destino.')
  const data = (await res.json()) as { trashed?: boolean }
  return data.trashed !== true
}

// Upload generated bytes as-is; omit metadata mimeType to avoid conversion.
export async function uploadBinary(
  token: string,
  name: string,
  bytes: Uint8Array,
  contentType: string,
  parentId: string,
): Promise<string> {
  const boundary = `ttg${randomBytes(12).toString('hex')}`
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify({ name, parents: [parentId] })}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  const tail = `\r\n--${boundary}--`
  const body = Buffer.concat([
    Buffer.from(head, 'utf8'),
    Buffer.from(bytes),
    Buffer.from(tail, 'utf8'),
  ])

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (res.status === 404) {
    throw new GoogleError(
      'La carpeta de destino en Drive ya no existe.',
      'Se creará una nueva al reintentar.',
      'FOLDER_GONE',
    )
  }
  if (!res.ok) throw await driveError(res, 'Google no pudo subir el documento a Drive.')
  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new GoogleError('Google no devolvió el documento subido.')
  return data.id
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    const transient = /\b(429|500|503)\b|rate|quota/i.test(msg)
    if (!transient) throw err
    await new Promise((r) => setTimeout(r, 1500))
    return fn()
  }
}


export interface SheetTab {
  gid: string
  title: string
}

export async function listSheetTabs(token: string, spreadsheetId: string): Promise<SheetTab[]> {
  const res = await fetch(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw await driveError(res, 'Google no pudo leer la hoja de cálculo.')
  const meta = (await res.json()) as {
    sheets?: { properties?: { sheetId?: number; title?: string } }[]
  }
  return (meta.sheets ?? [])
    .map((s) => ({
      gid: String(s.properties?.sheetId ?? ''),
      title: s.properties?.title ?? '',
    }))
    .filter((t) => t.gid !== '' && t.title !== '')
}

export async function readSheetTable(
  token: string,
  spreadsheetId: string,
  gid: string | null,
): Promise<{ columns: string[]; rows: Record<string, string>[]; tabTitle: string }> {
  const auth = { authorization: `Bearer ${token}` }

  const tabs = await listSheetTabs(token, spreadsheetId)
  if (tabs.length === 0) throw new GoogleError('La hoja de cálculo no tiene ninguna pestaña.')
  const wanted = gid === null ? tabs[0] : tabs.find((t) => t.gid === gid)
  if (!wanted) {
    throw new GoogleError(
      'La pestaña a la que apunta el enlace ya no existe en la hoja de cálculo.',
      'Elige la pestaña correcta en el selector de la barra superior, o vuelve a copiar el enlace con la pestaña abierta.',
    )
  }
  const title = wanted.title

  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`)
  const valRes = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${range}?majorDimension=ROWS`, {
    headers: auth,
  })
  if (!valRes.ok) throw await driveError(valRes, 'Google no pudo leer los datos de la hoja.')
  const values = ((await valRes.json()) as { values?: string[][] }).values ?? []

  const header = values[0] ?? []
  const used = new Set<string>()
  const columns = header.map((h, i) =>
    uniqueName(used, String(h ?? '').trim() || `Columna ${i + 1}`),
  )
  if (columns.length === 0) {
    throw new GoogleError('La hoja está vacía o no tiene una fila de encabezados.')
  }

  const rows = values
    .slice(1)
    .map((raw) => {
      const row: Record<string, string> = {}
      columns.forEach((col, i) => {
        row[col] = String(raw[i] ?? '')
      })
      return row
    })
    .filter((row) => columns.some((c) => row[c].trim() !== ''))
  if (rows.length === 0) {
    throw new GoogleError('La hoja tiene encabezados pero ninguna fila con datos.')
  }

  return { columns, rows, tabTitle: title }
}
