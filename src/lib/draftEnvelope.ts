/**
 * Pure helpers for the per-user workspace draft (state/draftStorage.ts).
 *
 * The draft has TWO homes: Postgres (source of truth, follows the account
 * across browsers) and a per-user localStorage "mirror" written synchronously
 * on every change (crash safety for the debounce window before the DB write).
 * Both store the same envelope: the zustand-persist JSON plus the client
 * clock at save time, so hydration can pick the newest of the two.
 */

export interface DraftEnvelope {
  /** Client clock (ms epoch) when this draft was produced. */
  savedAt: number
  /** The zustand persist JSON string, opaque here. */
  payload: string
}

/** Pre-multiuser localStorage keys: the draft shared by the whole browser and
 * the email of whoever wrote it (the old cross-user reset mitigation). */
export const LEGACY_WORKSPACE_KEY = 'ttg-workspace'
export const LEGACY_LAST_USER_KEY = 'ttg-last-user'

const MIRROR_PREFIX = 'ttg-workspace:'

/** localStorage key of a user's draft mirror. */
export function mirrorKey(userId: string): string {
  return MIRROR_PREFIX + userId
}

/** True for a draft-mirror key that belongs to ANOTHER user: removed on
 * hydration so no draft lingers readable on a shared browser (theirs is in
 * the DB — nothing is lost). The legacy shared key does not match (no id). */
export function isForeignMirrorKey(key: string, userId: string): boolean {
  return key.startsWith(MIRROR_PREFIX) && key !== mirrorKey(userId)
}

export function encodeEnvelope(e: DraftEnvelope): string {
  return JSON.stringify(e)
}

/** Parse an envelope, tolerating absence and corruption (null on both). */
export function decodeEnvelope(raw: string | null): DraftEnvelope | null {
  if (raw === null) return null
  try {
    const v = JSON.parse(raw) as { savedAt?: unknown; payload?: unknown }
    if (typeof v?.payload !== 'string') return null
    const savedAt = typeof v.savedAt === 'number' && Number.isFinite(v.savedAt) ? v.savedAt : 0
    return { savedAt, payload: v.payload }
  } catch {
    return null
  }
}

/** The newest candidate (by client clock). Ties go to the LATER argument —
 * call as newestDraft(mirror, db) so the DB wins when clocks agree. */
export function newestDraft(...candidates: (DraftEnvelope | null)[]): DraftEnvelope | null {
  let best: DraftEnvelope | null = null
  for (const c of candidates) {
    if (c && (!best || c.savedAt >= best.savedAt)) best = c
  }
  return best
}
