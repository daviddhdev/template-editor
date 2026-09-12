
import { createHash, randomBytes } from 'node:crypto'

export const SESSION_COOKIE = 'ttg_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000
export const RENEW_BELOW_MS = SESSION_TTL_MS / 2

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function needsRenewal(expiresAt: Date, now: number = Date.now()): boolean {
  return expiresAt.getTime() - now < RENEW_BELOW_MS
}

export function sessionCookieOptions(secure: boolean, maxAgeMs: number = SESSION_TTL_MS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure,
    maxAge: Math.floor(maxAgeMs / 1000),
  }
}

// Require an exact @domain suffix; a bare endsWith would admit evil-domain.es.
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
