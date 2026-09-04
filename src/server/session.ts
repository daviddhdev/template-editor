/**
 * DB-backed sessions (SERVER ONLY — import dynamically from server-function
 * handlers, same pattern as db.ts/googleClient.ts). The cookie carries an
 * opaque random token; the sessions table stores only its SHA-256 hash, so a
 * leaked DB dump cannot impersonate anyone and logout revokes server-side.
 */

import {
  deleteCookie,
  getCookie,
  getRequestUrl,
  setCookie,
} from '@tanstack/react-start/server'
import { getSql } from './db'
import {
  hashToken,
  needsRenewal,
  newSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from './authHelpers'

export interface SessionUser {
  id: string
  email: string
}

/** Standard Result error a protected server fn returns without a session.
 * `code: 'AUTH'` is the sentinel the client redirects to /login on. */
export const AUTH_ERROR = {
  ok: false as const,
  error: 'Tu sesión ha caducado o no has iniciado sesión.',
  hint: 'Vuelve a entrar con tu cuenta de Google.',
  code: 'AUTH' as const,
}

/**
 * Local-only identity for the internal product demo. This is intentionally
 * gated by both the development runtime and an explicit opt-in env var so it
 * cannot weaken authentication in production. It lets the demo open the
 * authenticated editor locally when Postgres/OAuth are unavailable. The demo
 * harness intercepts generatePdfFn and renders PDFs in its own Chromium, so
 * the capture does not exercise src/server/pdf.ts or its browser pool.
 */
const DEMO_USER: SessionUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'demo@local.invalid',
}

function demoUser(): SessionUser | null {
  return process.env.NODE_ENV === 'development' && process.env.TTG_DEMO_MODE === '1'
    ? DEMO_USER
    : null
}

function secureCookie(): boolean {
  // x-forwarded-proto aware — works in dev http and behind a TLS proxy.
  return getRequestUrl().protocol === 'https:'
}

/** Create a session for the user and set its cookie on the response. */
export async function createSession(userId: string): Promise<void> {
  const sql = await getSql()
  const token = newSessionToken()
  // Opportunistic pruning: login is rare enough to absorb it, and it bounds
  // the table without needing a scheduler.
  await sql`DELETE FROM sessions WHERE expires_at < now()`
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${hashToken(token)}, ${userId}, now() + interval '30 days')`
  setCookie(SESSION_COOKIE, token, sessionCookieOptions(secureCookie()))
}

/** Revoke the current session (if any) and drop its cookie. */
export async function destroySession(): Promise<void> {
  const token = getCookie(SESSION_COOKIE)
  if (token) {
    const sql = await getSql()
    await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`
  }
  deleteCookie(SESSION_COOKIE, { path: '/' })
}

/** The logged-in user, or null. Renews the session (sliding 30 days) once
 * less than half its TTL remains. */
export async function currentUser(): Promise<SessionUser | null> {
  const localDemo = demoUser()
  if (localDemo) return localDemo
  const token = getCookie(SESSION_COOKIE)
  if (!token) return null
  const sql = await getSql()
  const hash = hashToken(token)
  const rows = await sql`
    SELECT u.id, u.email, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hash} AND s.expires_at > now()`
  if (rows.length === 0) return null
  if (needsRenewal(rows[0].expires_at as Date)) {
    await sql`UPDATE sessions SET expires_at = now() + interval '30 days'
      WHERE token_hash = ${hash}`
    setCookie(SESSION_COOKIE, token, sessionCookieOptions(secureCookie()))
  }
  return { id: rows[0].id as string, email: rows[0].email as string }
}

/** Handlers open with:
 *    const s = await import('./session')
 *    const user = await s.requireUser()
 *    if (!user) return s.AUTH_ERROR
 * (null instead of throw keeps the codebase's Result style). */
export const requireUser = currentUser
