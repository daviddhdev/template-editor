
export interface DraftEnvelope {
  savedAt: number
  payload: string
}

export const LEGACY_WORKSPACE_KEY = 'ttg-workspace'
export const LEGACY_LAST_USER_KEY = 'ttg-last-user'

const MIRROR_PREFIX = 'ttg-workspace:'

export function mirrorKey(userId: string): string {
  return MIRROR_PREFIX + userId
}

export function isForeignMirrorKey(key: string, userId: string): boolean {
  return key.startsWith(MIRROR_PREFIX) && key !== mirrorKey(userId)
}

export function encodeEnvelope(e: DraftEnvelope): string {
  return JSON.stringify(e)
}

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

export function newestDraft(...candidates: (DraftEnvelope | null)[]): DraftEnvelope | null {
  let best: DraftEnvelope | null = null
  for (const c of candidates) {
    if (c && (!best || c.savedAt >= best.savedAt)) best = c
  }
  return best
}
