/**
 * Pure session/auth helpers (no DB, no request context) so they can be unit
 * tested. The stateful side (cookies + sessions table) lives in session.ts.
 */

import { createHash, randomBytes } from 'node:crypto'

export const SESSION_COOKIE = 'ttg_session'
/** Sessions last 30 days, renewed (sliding) once less than half remains. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000
export const RENEW_BELOW_MS = SESSION_TTL_MS / 2

/** Opaque session token for the cookie. Only its hash reaches the DB. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/** SHA-256 hex of the token — what the sessions table stores. Looking rows up
 * BY hash also makes secret comparison timing moot. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Sliding renewal: refresh the expiry once less than half the TTL remains. */
export function needsRenewal(expiresAt: Date, now: number = Date.now()): boolean {
  return expiresAt.getTime() - now < RENEW_BELOW_MS
}

/** Cookie attributes for the session cookie (cookie-es serialize options).
 * `secure` comes from the request protocol — never from NODE_ENV — so dev
 * http://localhost works and an https deploy behind a proxy is safe. */
export function sessionCookieOptions(secure: boolean, maxAgeMs: number = SESSION_TTL_MS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure,
    maxAge: Math.floor(maxAgeMs / 1000),
  }
}

/**
 * Login domain gate (defense in depth over the OAuth app's "Internal" type):
 * accept when the id_token's `hd` claim matches, or when Google verified the
 * email and it belongs to the domain (exact `@domain` suffix — a bare
 * endsWith would let evil-domain.es through). No domain configured = open
 * (dev); the caller warns.
 */
export function domainAllowed(
  email: string | null,
  hd: string | undefined,
  emailVerified: boolean | undefined,
  allowed: string | undefined,
): boolean {
  if (!allowed) return true
  if (hd === allowed) return true
  return emailVerified === true && !!email && email.toLowerCase().endsWith(`@${allowed.toLowerCase()}`)
}
