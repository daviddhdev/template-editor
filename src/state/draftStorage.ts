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

/**
 * zustand-persist storage for the workspace draft, per USER instead of per
 * browser:
 *
 *  - Postgres is the source of truth (workspace_drafts, one row per user):
 *    the draft follows the account across browsers and machines.
 *  - A per-user localStorage mirror (`ttg-workspace:<userId>`) is written
 *    synchronously on every change: it covers the debounce window (a reload
 *    right after typing loses nothing) and survives the DB being briefly
 *    down. Hydration picks the newest of mirror vs DB and re-syncs the loser.
 *  - Writes to the DB are debounced (SAVE_DEBOUNCE_MS) and skipped when the
 *    payload didn't change; a pagehide flush narrows the window further.
 *
 * configureDraftStorage() must run before the store rehydrates (the layout
 * route does it with the session user). Other users' mirrors found on this
 * browser are deleted on hydration — their drafts live in the DB.
 */

const SAVE_DEBOUNCE_MS = 2000

interface DraftUser {
  id: string
  email: string
}

let currentUser: DraftUser | null = null
let notify: (text: string) => void = () => {}

/** Writes are ignored until the user's draft finished hydrating (getItem):
 * the store mutations that happen in between (the blank reset on a user
 * switch, stray notices) must never overwrite the account's real draft. */
let ready = false

/** Payload last confirmed to be in the DB (skip identical saves). */
let lastSynced: string | null = null
let pending: DraftEnvelope | null = null
let timer: ReturnType<typeof setTimeout> | null = null
/** Serializes flushes so two never race (last resolved value = DB in sync). */
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
    // Quota exceeded (inlined images can pass ~5 MB): the DB save still runs,
    // so autosave keeps working — only the crash-window mirror is lost.
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

/** Send any pending draft to the DB now. Resolves true when the DB has the
 * latest state (used by logout to decide if the local mirror can go). */
export function flushWorkspaceDraft(): Promise<boolean> {
  inFlight = inFlight.then(doFlush)
  return inFlight
}

function scheduleSave(e: DraftEnvelope): void {
  pending = e
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flushWorkspaceDraft(), SAVE_DEBOUNCE_MS)
}

/** Flush pending work to the DB and, if it got there, drop the local mirror
 * (the draft lives in the account now — nothing personal stays behind). */
export async function shutdownDraftSync(): Promise<void> {
  const user = currentUser
  const synced = await flushWorkspaceDraft()
  if (user && synced) {
    try {
      localStorage.removeItem(mirrorKey(user.id))
    } catch {
      /* storage unavailable: nothing to remove */
    }
  }
  currentUser = null
  ready = false
}

/** Remove other users' mirrors (privacy on shared browsers) and adopt the
 * pre-multiuser draft when it belonged to this same user. */
function collectLocalCandidate(user: DraftUser): DraftEnvelope | null {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)
    if (k && isForeignMirrorKey(k, user.id)) localStorage.removeItem(k)
  }
  let legacy: DraftEnvelope | null = null
  const legacyRaw = localStorage.getItem(LEGACY_WORKSPACE_KEY)
  if (legacyRaw !== null) {
    // savedAt 0: if a DB draft exists it wins; otherwise the legacy draft is
    // restored and pushed to the DB (one-time migration).
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
      // Network/DB hiccup: fall back to the local mirror; the next change
      // will retry the DB write.
    }

    const winner = newestDraft(local, db) // DB wins ties
    ready = true
    if (!winner) return null
    if (dbOk) {
      lastSynced = db?.payload ?? null
      // Local newer than the account copy (crash before the debounced save,
      // or DB briefly down last session): push it back up.
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

// Narrow the debounce window on tab close/navigation: best effort (the
// request may not finish), but the mirror already has the exact state, so a
// same-browser reopen loses nothing either way.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (pending) void flushWorkspaceDraft()
  })
}
