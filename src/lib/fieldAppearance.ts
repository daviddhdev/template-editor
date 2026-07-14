export const FIELD_STYLE_ATTR = 'data-ttg-field-style'

export interface FieldAppearance {
  /** Explicit override stored for this occurrence; null means inherited. */
  fontSizePt: number | null
  /** Explicit opaque colour override, normalised to #RRGGBB; null = inherited. */
  colorHex: string | null
  /** Effective values shown in the controls, including inherited document CSS. */
  effectiveFontSizePt: number
  effectiveColorHex: string
}

const RGB_RE = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*(?:\.\d+)?))?\s*\)$/i

/** Normalise browser/CSS opaque colours to #RRGGBB. */
export function colorToHex(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw || raw.toLowerCase() === 'transparent') return null
  const short = raw.match(/^#([\da-f]{3})$/i)
  if (short) return `#${[...short[1]].map((c) => c + c).join('').toUpperCase()}`
  const long = raw.match(/^#([\da-f]{6})(?:ff)?$/i)
  if (long) return `#${long[1].toUpperCase()}`
  const rgb = raw.match(RGB_RE)
  if (!rgb || (rgb[4] !== undefined && Number(rgb[4]) < 1)) return null
  const channel = (n: string) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0')
  return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`.toUpperCase()
}

export function validFontSizePt(value: number): boolean {
  return Number.isFinite(value) && value >= 1 && value <= 400
}

function pxToPt(px: string): number {
  const n = Number.parseFloat(px)
  return Number.isFinite(n) ? Math.round(n * 0.75 * 100) / 100 : 11
}

function styleWrapper(chip: HTMLElement): HTMLElement | null {
  return chip.closest<HTMLElement>(`[${FIELD_STYLE_ATTR}]`)
}

export function readFieldAppearance(chip: HTMLElement): FieldAppearance {
  const wrapper = styleWrapper(chip)
  const computed = chip.ownerDocument.defaultView?.getComputedStyle(chip)
  const explicitSize = wrapper?.style.fontSize.match(/^([\d.]+)pt$/i)
  return {
    fontSizePt: explicitSize ? Number(explicitSize[1]) : null,
    colorHex: colorToHex(wrapper?.style.color),
    effectiveFontSizePt: pxToPt(computed?.fontSize ?? '14.6667px'),
    effectiveColorHex: colorToHex(computed?.color) ?? '#000000',
  }
}

/** Apply an explicit override to exactly one decorated chip occurrence. */
export function setFieldAppearance(
  chip: HTMLElement,
  patch: { fontSizePt?: number | null; colorHex?: string | null },
): void {
  let wrapper = styleWrapper(chip)
  const current = readFieldAppearance(chip)
  const nextSize = patch.fontSizePt === undefined ? current.fontSizePt : patch.fontSizePt
  const nextColor = patch.colorHex === undefined ? current.colorHex : colorToHex(patch.colorHex)

  if (nextSize === null && nextColor === null) {
    if (wrapper) {
      wrapper.parentNode?.insertBefore(chip, wrapper)
      wrapper.remove()
    }
    return
  }

  if (!wrapper) {
    wrapper = chip.ownerDocument.createElement('span')
    wrapper.setAttribute(FIELD_STYLE_ATTR, '')
    chip.parentNode?.insertBefore(wrapper, chip)
    wrapper.appendChild(chip)
  }
  wrapper.style.fontSize = nextSize !== null && validFontSizePt(nextSize) ? `${nextSize}pt` : ''
  wrapper.style.color = nextColor ?? ''
}

/** Colours used by actual document text, weighted by visible character count. */
export function documentTextColors(doc: Document, current?: string): string[] {
  const counts = new Map<string, number>()
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = (node as Text).data.replace(/\s+/g, '')
    const parent = node.parentElement
    if (!text || !parent || parent.closest('.ttg-cond')) continue
    const source = parent.classList.contains('ttg-chip')
      ? (parent.closest<HTMLElement>(`[${FIELD_STYLE_ATTR}]`)?.parentElement ?? parent.parentElement ?? parent)
      : parent
    const color = colorToHex(doc.defaultView?.getComputedStyle(source).color)
    if (color) counts.set(color, (counts.get(color) ?? 0) + text.length)
  }
  const ordered = [...counts].sort((a, b) => b[1] - a[1]).map(([color]) => color)
  const selected = colorToHex(current)
  if (selected) return [selected, ...ordered.filter((color) => color !== selected)]
  return ordered
}
