/**
 * Google OAuth + Drive helpers. SERVER ONLY — import this module dynamically
 * from inside server-function handlers (same pattern as playwright in pdf.ts)
 * so none of it ever reaches the client bundle.
 *
 * Auth model: the Google OAuth consent IS the app's login. Each exchange
 * yields the user's identity (id_token) plus a refresh token, persisted PER
 * USER in the users table (usersDb.ts) — google.ts turns that into an app
 * session. This module stays a pure Google-API client: it never touches the
 * sessions table.
 *
 * Why Drive upload instead of Docs API `replaceAllText` on a copy: the fields,
 * conditionals and repeatable sections live in the HTML edited IN THE APP, not
 * in the original Doc, so there is nothing to replace inside Google's copy.
 * Instead the fully-resolved HTML is uploaded converted to a Google Doc —
 * Google's own layout engine (Kix, the same one that laid out the original)
 * paginates it — exported as PDF, and the temporary Doc is deleted.
 */

import { randomBytes } from 'node:crypto'
import { uniqueName } from '../lib/uniqueNames'
import { domainAllowed } from './authHelpers'
import { readDotEnv } from './env'

/** drive.file: create/export/delete the app's own temp Docs.
 *  drive.readonly: READ the user's private Docs/Sheets (template + data);
 *  it is also an accepted scope for the Sheets API values endpoints.
 *  drive (full): WRITE into a user-chosen output folder — drive.file only
 *  reaches app-created files, not a folder the user pastes by URL. New
 *  consents ask for the full scope (it covers the other two); connections
 *  made before it need a reconnect to upload (see GoogleStatus.canWrite). */
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

/** Error with a user-facing message (Spanish) + optional actionable hint. */
export class GoogleError extends Error {
  hint?: string
  /** Machine-readable code for errors the client must react to (not just show). */
  code?: 'FOLDER_GONE'
  constructor(message: string, hint?: string, code?: 'FOLDER_GONE') {
    super(message)
    this.hint = hint
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Credentials (.env / process.env)
// ---------------------------------------------------------------------------

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

/** Google Workspace domain allowed to log in (defense in depth over the OAuth
 * app's "Internal" type). Empty/unset = anyone (dev only; exchange warns). */
function allowedDomain(): string | undefined {
  const env = { ...readDotEnv(), ...process.env }
  return env.ALLOWED_GOOGLE_HD?.trim() || undefined
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

/** Pending `state` values (CSRF protection), each tied to its redirect URI. */
const pendingStates = new Map<string, { redirectUri: string; expiresAt: number }>()

function redirectUriFor(origin: string): string {
  return `${origin.replace(/\/$/, '')}/oauth/callback`
}

/** Build the Google consent URL the browser must visit. */
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
    // offline + consent: required for Google to issue a refresh token.
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  // UX hint only (pre-filters Google's account picker); the authoritative
  // domain check happens server-side in exchangeCode.
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

/** Identity claims from an id_token JWT (no verification needed: it came to
 * the server straight from Google's token endpoint over TLS). */
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

/** Tokens + identity from a completed login. google.ts persists them. */
export interface ExchangedTokens {
  email: string
  refreshToken: string
  accessToken: string
  /** Epoch ms after which accessToken must be refreshed. */
  expiresAt: number
  scopes: string
}

/** Best-effort revoke of a token Google just issued (or a dead connection). */
async function revokeToken(token: string): Promise<void> {
  await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
  }).catch(() => {})
}

/** Exchange the callback's authorization code for tokens + identity, gating
 * on the allowed Workspace domain. Persisting is the caller's job. */
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
    // No identity — cannot create an account. Don't leave the grant dangling.
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
  /** Credentials present in .env — the connect button can work at all. */
  configured: boolean
  /** The user's Google connection is alive (refresh token stored). */
  connected: boolean
  /** The connection can READ private Docs/Sheets. False on connections made
   * before the read scope existed — the UI offers a reconnect. */
  canRead: boolean
  /** The connection can WRITE into a user-chosen Drive folder (full drive
   * scope). False on older connections — the UI offers a reconnect. */
  canWrite: boolean
  email: string | null
}

export async function getStatusForUser(userId: string): Promise<GoogleStatus> {
  const { readGoogleTokens } = await import('./usersDb')
  const tokens = await readGoogleTokens(userId)
  // Exact-token match: FULL_SCOPE is a prefix of drive.file/drive.readonly,
  // so a substring check would report write access on old connections.
  const granted = new Set(tokens?.scopes.split(/\s+/) ?? [])
  const connected = tokens?.refreshToken != null
  return {
    configured: loadConfig() !== null,
    connected,
    canRead: connected && (granted.has(READ_SCOPE) || granted.has(FULL_SCOPE)),
    canWrite: connected && granted.has(FULL_SCOPE),
    email: null, // the session, not the Google connection, names the user now
  }
}

const RECONNECT = new GoogleError(
  'La conexión con Google ya no es válida.',
  'Vuelve a conectar tu cuenta de Google desde la barra superior.',
)

/** Per-user access-token cache. The DB row is the durable store; this only
 * saves a SELECT per Google call on a single-node deploy. */
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>()
/** Concurrent-refresh dedupe: parallel jobs for one user share ONE refresh
 * (racing refreshes can rate-limit or invalidate each other at Google). */
const pendingRefresh = new Map<string, Promise<string>>()

/** Valid access token for the user, refreshing against Google when expired. */
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
      // Refresh token revoked/expired: the stored connection is dead.
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

// ---------------------------------------------------------------------------
// Drive: HTML -> temporary Google Doc -> PDF
// ---------------------------------------------------------------------------

async function driveError(res: Response, fallback: string): Promise<GoogleError> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } }
    detail = body.error?.message ?? ''
  } catch {
    /* non-JSON body */
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
  // Drive answers 404 for files the account cannot see (existence is hidden).
  if (res.status === 404) {
    return new GoogleError(
      'Tu cuenta de Google conectada no tiene acceso a ese archivo (o el enlace no existe).',
      'Compártelo con la cuenta conectada, conéctate con la cuenta correcta, o hazlo público.',
    )
  }
  return new GoogleError(fallback, detail || `Error ${res.status} de Google.`)
}

/**
 * Upload arbitrary content converted to a (temporary) Google Doc through
 * Drive's import conversion — the same converter `files.copy` would run, but
 * the resulting Doc is app-created, so the drive.file scope grants full
 * write/export/delete on it (no broader scope needed).
 *
 * The multipart body is assembled with Buffer.concat: template-string
 * concatenation would corrupt binary payloads (e.g. DOCX bytes).
 */
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

/** Upload an HTML document converted to a (temporary) Google Doc. */
export async function uploadHtmlAsDoc(token: string, name: string, html: string): Promise<string> {
  return uploadAsGoogleDoc(token, name, html, 'text/html; charset=UTF-8')
}

/** Name + mimeType of a Drive file (drive.readonly covers it). */
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

/** Raw bytes of a NON-native Drive file (e.g. a .docx). Native Google files
 * have no bytes to download — use exportFile for those. */
export async function downloadFileBytes(token: string, fileId: string): Promise<Uint8Array> {
  const res = await fetch(`${DRIVE_FILES}/${fileId}?alt=media`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw await driveError(res, 'Google no pudo descargar el archivo original.')
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Substitute literal text across a Google Doc (headers/footers included) with
 * one documents.batchUpdate call. Needs the Google Docs API enabled; works
 * under drive.file because the target Doc is app-created.
 * Returns how many occurrences each find-string replaced (0 = not present).
 */
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

/** Export any Google file (Doc/Sheet) in the requested format via Drive.
 * Works on every file the connected account can read (drive.readonly). */
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


/** File display name (the Drive HTML export has no <title> to read it from). */
export async function fileName(token: string, fileId: string): Promise<string | null> {
  const res = await fetch(`${DRIVE_FILES}/${fileId}?fields=name`, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null)
  if (!res?.ok) return null
  const data = (await res.json().catch(() => null)) as { name?: string } | null
  return data?.name ?? null
}

/** Delete the temporary Doc (best effort — a leftover is harmless). */
export async function deleteFile(token: string, fileId: string): Promise<void> {
  await fetch(`${DRIVE_FILES}/${fileId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => {})
}

// ---------------------------------------------------------------------------
// Drive: output folder + upload of generated documents
// ---------------------------------------------------------------------------

const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Create a Drive folder (at the root when parentId is omitted). */
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

/** Whether a remembered folder still exists and is not in the trash. */
export async function folderAlive(token: string, folderId: string): Promise<boolean> {
  const res = await fetch(`${DRIVE_FILES}/${folderId}?fields=id,trashed`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return false
  if (!res.ok) throw await driveError(res, 'Google no pudo comprobar la carpeta de destino.')
  const data = (await res.json()) as { trashed?: boolean }
  return data.trashed !== true
}

/**
 * Upload a generated document (PDF/DOCX bytes) into a folder, as-is — no
 * mimeType in the metadata, so Drive stores the binary without converting it.
 * Same Buffer.concat multipart as uploadAsGoogleDoc (see the note there).
 */
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
    // The batch folder was deleted mid-run; the client recreates it and retries.
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

/** One retry after a short pause on transient Google errors (429/5xx). */
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

// ---------------------------------------------------------------------------
// Sheets: read a private spreadsheet tab as table data
// ---------------------------------------------------------------------------

/** One tab of a spreadsheet: its stable gid and human title. */
export interface SheetTab {
  gid: string
  title: string
}

/** List a spreadsheet's tabs (Sheets API; works on any readable sheet). */
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

/**
 * Read one tab of a (possibly private) spreadsheet through the Sheets API and
 * normalise it to the same shape the public CSV source produces. The Sheets
 * API is used instead of Drive's CSV export because the latter ignores the
 * link's `gid` and always returns the FIRST tab.
 *
 * `gid` null = the link named no tab -> first tab. An EXPLICIT gid that no
 * longer exists errors instead of silently reading another tab's data.
 */
export async function readSheetTable(
  token: string,
  spreadsheetId: string,
  gid: string | null,
): Promise<{ columns: string[]; rows: Record<string, string>[]; tabTitle: string }> {
  const auth = { authorization: `Bearer ${token}` }

  // The values endpoint addresses tabs by TITLE; map the link's gid to it.
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

  // Whole-tab range: the title quoted, with inner quotes doubled.
  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`)
  const valRes = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${range}?majorDimension=ROWS`, {
    headers: auth,
  })
  if (!valRes.ok) throw await driveError(valRes, 'Google no pudo leer los datos de la hoja.')
  const values = ((await valRes.json()) as { values?: string[][] }).values ?? []

  const header = values[0] ?? []
  // Duplicate headers become "Nombre", "Nombre (2)"…: a repeated object key
  // would silently drop the earlier column's values from every row.
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
