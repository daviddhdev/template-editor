import { describe, expect, it } from 'vitest'
import {
  decodeEnvelope,
  encodeEnvelope,
  isForeignMirrorKey,
  LEGACY_WORKSPACE_KEY,
  mirrorKey,
  newestDraft,
} from './draftEnvelope'

describe('encodeEnvelope / decodeEnvelope', () => {
  it('round-trips', () => {
    const e = { savedAt: 1720000000000, payload: '{"state":{"editorHtml":"<p>x</p>"}}' }
    expect(decodeEnvelope(encodeEnvelope(e))).toEqual(e)
  })

  it('returns null on absence and corruption', () => {
    expect(decodeEnvelope(null)).toBeNull()
    expect(decodeEnvelope('')).toBeNull()
    expect(decodeEnvelope('not json')).toBeNull()
    expect(decodeEnvelope('123')).toBeNull()
    expect(decodeEnvelope('{"savedAt":1}')).toBeNull() // payload missing
    expect(decodeEnvelope('{"payload":42}')).toBeNull() // payload not a string
  })

  it('tolerates a missing or invalid savedAt (treated as oldest)', () => {
    expect(decodeEnvelope('{"payload":"p"}')).toEqual({ savedAt: 0, payload: 'p' })
    expect(decodeEnvelope('{"payload":"p","savedAt":"x"}')).toEqual({ savedAt: 0, payload: 'p' })
  })
})

describe('newestDraft', () => {
  const older = { savedAt: 100, payload: 'older' }
  const newer = { savedAt: 200, payload: 'newer' }

  it('picks the newest candidate regardless of order', () => {
    expect(newestDraft(older, newer)).toBe(newer)
    expect(newestDraft(newer, older)).toBe(newer)
  })

  it('ignores nulls and returns null when empty-handed', () => {
    expect(newestDraft(null, newer)).toBe(newer)
    expect(newestDraft(older, null)).toBe(older)
    expect(newestDraft(null, null)).toBeNull()
  })

  it('gives ties to the later argument (the DB copy)', () => {
    const mirror = { savedAt: 100, payload: 'mirror' }
    const db = { savedAt: 100, payload: 'db' }
    expect(newestDraft(mirror, db)).toBe(db)
  })
})

describe('mirror keys', () => {
  const uid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

  it('detects other users’ mirrors but not one’s own', () => {
    expect(isForeignMirrorKey(mirrorKey('other-user'), uid)).toBe(true)
    expect(isForeignMirrorKey(mirrorKey(uid), uid)).toBe(false)
  })

  it('never matches the legacy shared key or unrelated keys', () => {
    expect(isForeignMirrorKey(LEGACY_WORKSPACE_KEY, uid)).toBe(false)
    expect(isForeignMirrorKey('ttg-recipes', uid)).toBe(false)
  })
})
