// Server-only sessions. Store only a SHA-256 hash of the opaque cookie token.

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

export const AUTH_ERROR = {
  ok: false as const,
  error: 'Tu sesión ha caducado o no has iniciado sesión.',
  hint: 'Vuelve a entrar con tu cuenta de Google.',
  code: 'AUTH' as const,
}

// Demo identity is gated by both development mode and an explicit opt-in.
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
  return getRequestUrl().protocol === 'https:'
}

export async function createSession(userId: string): Promise<void> {
  const sql = await getSql()
  const token = newSessionToken()
  await sql`DELETE FROM sessions WHERE expires_at < now()`
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${hashToken(token)}, ${userId}, now() + interval '30 days')`
  setCookie(SESSION_COOKIE, token, sessionCookieOptions(secureCookie()))
}

export async function destroySession(): Promise<void> {
  const token = getCookie(SESSION_COOKIE)
  if (token) {
    const sql = await getSql()
    await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`
  }
  deleteCookie(SESSION_COOKIE, { path: '/' })
}

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

export const requireUser = currentUser
