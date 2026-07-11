/**
 * Browser-only fingerprints that answer ONE question: "has the document been
 * edited in the app since it was imported?" — the gate for the native
 * (mail-merge) generation route, which re-materialises the ORIGINAL Drive
 * file and would silently ignore any in-app change.
 *
 * A naive hash of the stored strings does not work: merely clicking into the
 * editor and out re-persists the browser's serialisation of the body
 * (DocCanvas saves on input/focusout), and the field chip round-trip
 * canonicalises `{{ TAG }}` into `{{TAG}}`. The fingerprint is therefore taken
 * over the editor-equivalent normal form: the exact string the editor would
 * persist had the user touched the document without changing anything.
 */

import { decorateFields, undecorateFields } from './editorHtml'

/** The string the editor would persist for this HTML with zero user edits. */
export function normalizeBodyHtml(html: string): string {
  return undecorateFields(decorateFields(html))
}

/** FNV-1a 64-bit hex digest. Synchronous (store actions cannot await). */
export function hashString(s: string): string {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < s.length; i++) {
    hash ^= BigInt(s.charCodeAt(i))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

export function fingerprintHtml(html: string): string {
  return hashString(normalizeBodyHtml(html))
}

/** CSS never goes through the browser (no re-serialisation) — hash directly. */
export function fingerprintCss(css: string): string {
  return hashString(css)
}
