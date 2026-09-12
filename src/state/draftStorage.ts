import { getDraftFn, saveDraftFn } from '../server/draftsDb'
import { authGuard } from '../lib/authRedirect'
import {
  decodeEnvelope,
  encodeEnvelope,
  isForeignMirrorKey,
  LEGACY_LAST_USER_KEY,
  LEGACY_WORKSPACE_KEY,
  mirrorKey,
  newestDraft,
  type DraftEnvelope,
} from '../lib/draftEnvelope'

// Per-user draft storage: synchronous local mirror plus debounced DB writes.

const SAVE_DEBOUNCE_MS = 2000

interface DraftUser {
  id: string
  email: string
}

let currentUser: DraftUser | null = null
let notify: (text: string) => void = () => {}

let ready = false

let lastSynced: string | null = null
let pending: DraftEnvelope | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<boolean> = Promise.resolve(true)
let failureNotified = false

export function configureDraftStorage(user: DraftUser, onError: (text: string) => void): void {
  currentUser = user
  notify = onError
  ready = false
}

function writeMirror(userId: string, e: DraftEnvelope): void {
  try {
    localStorage.setItem(mirrorKey(userId), encodeEnvelope(e))
  } catch {
  }
}

async function doFlush(): Promise<boolean> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const p = pending
  if (!p) return true
  try {
    const res = authGuard(await saveDraftFn({ data: { payload: p.payload, savedAtMs: p.savedAt } }))
    if (!res.ok) {
      if (!failureNotified) {
        failureNotified = true
        notify(`El borrador no se pudo guardar en el servidor: ${res.error}`)
      }
      return false
    }
    lastSynced = p.payload
    failureNotified = false
    if (pending === p) pending = null
    return pending === null
  } catch {
    if (!failureNotified) {
      failureNotified = true
      notify('El borrador no se pudo guardar en el servidor. Se reintentará con el próximo cambio.')
    }
    return false
  }
}

export function flushWorkspaceDraft(): Promise<boolean> {
  inFlight = inFlight.then(doFlush)
  return inFlight
}

function scheduleSave(e: DraftEnvelope): void {
  pending = e
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flushWorkspaceDraft(), SAVE_DEBOUNCE_MS)
}

export async function shutdownDraftSync(): Promise<void> {
  const user = currentUser
  const synced = await flushWorkspaceDraft()
  if (user && synced) {
    try {
      localStorage.removeItem(mirrorKey(user.id))
    } catch {
    }
  }
  currentUser = null
  ready = false
}

function collectLocalCandidate(user: DraftUser): DraftEnvelope | null {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)
    if (k && isForeignMirrorKey(k, user.id)) localStorage.removeItem(k)
  }
  let legacy: DraftEnvelope | null = null
  const legacyRaw = localStorage.getItem(LEGACY_WORKSPACE_KEY)
  if (legacyRaw !== null) {
    // Migrate the legacy shared draft once, only when the DB has no draft.
    if (localStorage.getItem(LEGACY_LAST_USER_KEY) === user.email) {
      legacy = { savedAt: 0, payload: legacyRaw }
    }
    localStorage.removeItem(LEGACY_WORKSPACE_KEY)
  }
  localStorage.removeItem(LEGACY_LAST_USER_KEY)
  const mirror = decodeEnvelope(localStorage.getItem(mirrorKey(user.id)))
  return mirror ?? legacy
}

export const draftStorage = {
  async getItem(_name: string): Promise<string | null> {
    const user = currentUser
    if (!user) return null
    const local = collectLocalCandidate(user)

    let db: DraftEnvelope | null = null
    let dbOk = false
    try {
      const res = await getDraftFn()
      if (res.ok) {
        dbOk = true
        db = res.data ? { savedAt: res.data.savedAtMs, payload: res.data.payload } : null
      }
    } catch {
    }

    const winner = newestDraft(local, db) // DB wins ties
    ready = true
    if (!winner) return null
    if (dbOk) {
      lastSynced = db?.payload ?? null
      if (winner !== db && winner.payload !== db?.payload) {
        scheduleSave({ savedAt: winner.savedAt || Date.now(), payload: winner.payload })
      }
    }
    writeMirror(user.id, winner)
    return winner.payload
  },

  setItem(_name: string, value: string): void {
    const user = currentUser
    if (!user || !ready) return
    const envelope = { savedAt: Date.now(), payload: value }
    writeMirror(user.id, envelope)
    if (value === lastSynced) {
      pending = null
      return
    }
    scheduleSave(envelope)
  },

  removeItem(_name: string): void {
    pending = null
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const user = currentUser
    if (user) localStorage.removeItem(mirrorKey(user.id))
  },
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (pending) void flushWorkspaceDraft()
  })
}
