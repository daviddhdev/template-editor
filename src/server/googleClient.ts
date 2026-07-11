/**
 * Google OAuth + Drive helpers. SERVER ONLY — import this module dynamically
 * from inside server-function handlers (same pattern as playwright in pdf.ts)
 * so none of it ever reaches the client bundle.
 *
 * Auth model: single-user local tool. The OAuth "authorization code" flow runs
 * once in the browser (/oauth/callback route); the refresh token is persisted
 * to `.google-oauth.json` in the project root (gitignored) so the connection
 * survives server restarts.
 *
 * Why Drive upload instead of Docs API `replaceAllText` on a copy: the fields,
 * conditionals and repeatable sections live in the HTML edited IN THE APP, not
 * in the original Doc, so there is nothing to replace inside Google's copy.
 * Instead the fully-resolved HTML is uploaded converted to a Google Doc —
 * Google's own layout engine (Kix, the same one that laid out the original)
 * paginates it — exported as PDF, and the temporary Doc is deleted.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { uniqueName } from '../lib/uniqueNames'
import { readDotEnv } from './env'

/** drive.file: create/export/delete the app's own temp Docs.
 *  drive.readonly: READ the user's private Docs/Sheets (template + data);
 *  it is also an accepted scope for the Sheets API values endpoints. */
const READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const SCOPES = `https://www.googleapis.com/auth/drive.file ${READ_SCOPE} openid email`
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
  constructor(message: string, hint?: string) {
    super(message)
    this.hint = hint
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

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

interface StoredTokens {
  refreshToken: string
  accessToken: string
  /** Epoch ms after which accessToken must be refreshed. */
  expiresAt: number
  email: string | null
  /** Space-separated scopes Google actually granted. Absent on connections
   * made before read access existed — those need a reconnect to read. */
  scopes?: string
}

const TOKEN_FILE = path.resolve(process.cwd(), '.google-oauth.json')

let cachedTokens: StoredTokens | null | undefined

function readTokens(): StoredTokens | null {
  if (cachedTokens !== undefined) return cachedTokens
  try {
    cachedTokens = existsSync(TOKEN_FILE)
      ? (JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as StoredTokens)
      : null
  } catch {
    cachedTokens = null
  }
  return cachedTokens
}

async function saveTokens(tokens: StoredTokens): Promise<void> {
  cachedTokens = tokens
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8')
}

async function clearTokens(): Promise<void> {
  cachedTokens = null
  try {
    await unlink(TOKEN_FILE)
  } catch {
    /* already gone */
  }
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

/** Email claim from an id_token JWT (no verification needed: it came to the
 * server straight from Google's token endpoint over TLS). */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.email === 'string' ? payload.email : null
  } catch {
    return null
  }
}

/** Exchange the callback's authorization code for tokens and persist them. */
export async function exchangeCode(code: string, state: string): Promise<{ email: string | null }> {
  const cfg = requireConfig()
  const pending = pendingStates.get(state)
  if (!pending || pending.expiresAt < Date.now()) {
    throw new GoogleError(
      'La conexión con Google caducó o no se inició desde esta aplicación.',
      'Vuelve a pulsar "Conectar Google" e inténtalo de nuevo.',
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

  const email = emailFromIdToken(data.id_token)
  await saveTokens({
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    email,
    scopes: data.scope,
  })
  return { email }
}

export interface GoogleStatus {
  /** Credentials present in .env — the connect button can work at all. */
  configured: boolean
  /** A Google account is connected (refresh token stored). */
  connected: boolean
  /** The connection can READ private Docs/Sheets. False on connections made
   * before the read scope existed — the UI offers a reconnect. */
  canRead: boolean
  email: string | null
}

export function getStatus(): GoogleStatus {
  const tokens = readTokens()
  return {
    configured: loadConfig() !== null,
    connected: tokens !== null,
    canRead: tokens?.scopes?.includes(READ_SCOPE) ?? false,
    email: tokens?.email ?? null,
  }
}

/** Revoke (best effort) and forget the stored connection. */
export async function disconnect(): Promise<void> {
  const tokens = readTokens()
  if (tokens) {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(tokens.refreshToken)}`, {
      method: 'POST',
    }).catch(() => {})
  }
  await clearTokens()
}

const RECONNECT = new GoogleError(
  'La conexión con Google ya no es válida.',
  'Vuelve a conectar tu cuenta de Google desde la barra superior.',
)

/** Valid access token, refreshing it against Google when expired. */
export async function getAccessToken(): Promise<string> {
  const cfg = requireConfig()
  const tokens = readTokens()
  if (!tokens) throw RECONNECT
  if (tokens.expiresAt > Date.now()) return tokens.accessToken

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
    await clearTokens()
    throw RECONNECT
  }
  await saveTokens({
    ...tokens,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  })
  return data.access_token
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
    if (detail.toLowerCase().includes('insufficient') || detail.includes('SCOPE')) {
      return new GoogleError(
        'Tu conexión de Google no tiene el permiso de lectura.',
        'Desconecta y vuelve a conectar tu cuenta de Google para concederlo.',
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
