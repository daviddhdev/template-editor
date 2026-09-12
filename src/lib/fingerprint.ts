
import { decorateFields, undecorateFields } from './editorHtml'

export function normalizeBodyHtml(html: string): string {
  return undecorateFields(decorateFields(html))
}

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

export function fingerprintCss(css: string): string {
  return hashString(css)
}
