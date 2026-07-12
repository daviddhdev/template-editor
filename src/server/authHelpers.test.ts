import { describe, expect, it } from 'vitest'
import {
  domainAllowed,
  hashToken,
  needsRenewal,
  newSessionToken,
  RENEW_BELOW_MS,
  SESSION_TTL_MS,
  sessionCookieOptions,
} from './authHelpers'

describe('newSessionToken', () => {
  it('is long and URL-safe', () => {
    const t = newSessionToken()
    expect(t.length).toBeGreaterThanOrEqual(43) // 32 bytes in base64url
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => newSessionToken()))
    expect(seen.size).toBe(1000)
  })
})

describe('hashToken', () => {
  it('is deterministic sha256 hex', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })
})

describe('needsRenewal', () => {
  const now = Date.now()
  it('is false on a fresh session', () => {
    expect(needsRenewal(new Date(now + SESSION_TTL_MS), now)).toBe(false)
  })
  it('is true when less than half the TTL remains', () => {
    expect(needsRenewal(new Date(now + RENEW_BELOW_MS - 1), now)).toBe(true)
  })
  it('is false exactly at the renewal boundary', () => {
    expect(needsRenewal(new Date(now + RENEW_BELOW_MS), now)).toBe(false)
  })
})

describe('sessionCookieOptions', () => {
  it('locks the cookie down and converts the TTL to seconds', () => {
    expect(sessionCookieOptions(true)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: true,
      maxAge: 30 * 24 * 60 * 60,
    })
  })
  it('passes the secure flag through for dev http', () => {
    expect(sessionCookieOptions(false).secure).toBe(false)
  })
})

describe('domainAllowed', () => {
  const allow = 'mecides.es'
  it('accepts a matching hd claim regardless of email verification', () => {
    expect(domainAllowed('x@mecides.es', 'mecides.es', undefined, allow)).toBe(true)
  })
  it('rejects a different hd claim without a verified domain email', () => {
    expect(domainAllowed('x@otra.com', 'otra.com', true, allow)).toBe(false)
  })
  it('accepts a verified email on the domain when hd is absent', () => {
    expect(domainAllowed('x@mecides.es', undefined, true, allow)).toBe(true)
    expect(domainAllowed('x@MECIDES.ES', undefined, true, allow)).toBe(true)
  })
  it('rejects an unverified email even on the domain', () => {
    expect(domainAllowed('x@mecides.es', undefined, false, allow)).toBe(false)
    expect(domainAllowed('x@mecides.es', undefined, undefined, allow)).toBe(false)
  })
  it('rejects lookalike domains (suffix tricks)', () => {
    expect(domainAllowed('x@evil-mecides.es', undefined, true, allow)).toBe(false)
    expect(domainAllowed('x@mecides.es.evil.com', undefined, true, allow)).toBe(false)
  })
  it('rejects a null email without hd', () => {
    expect(domainAllowed(null, undefined, true, allow)).toBe(false)
  })
  it('allows everything when no domain is configured (dev)', () => {
    expect(domainAllowed('x@cualquiera.com', undefined, true, undefined)).toBe(true)
    expect(domainAllowed('x@cualquiera.com', undefined, true, '')).toBe(true)
  })
})
