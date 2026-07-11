// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { CARET_ANCHOR, decorateFields, undecorateFields } from './editorHtml'
import { normalizeBodyHtml } from './fingerprint'

describe('decorateFields / undecorateFields', () => {
  it('adds a caret anchor after each chip; undecorate strips it', () => {
    const decorated = decorateFields('<p>Hola {{NOMBRE}}</p>')
    expect(decorated).toContain('ttg-chip')
    expect(decorated).toContain(CARET_ANCHOR)
    const storage = undecorateFields(decorated)
    expect(storage).toBe('<p>Hola {{NOMBRE}}</p>')
    expect(storage).not.toContain(CARET_ANCHOR)
  })

  it('a chip ending the block still gets an anchor (caret can sit after it)', () => {
    const decorated = decorateFields('<p>{{NOMBRE}}</p>')
    // …</span>ZWSP</p>
    expect(decorated).toMatch(new RegExp(`</span>${CARET_ANCHOR}</p>`))
  })

  it('unstyled chips flatten to the plain literal (previous behaviour)', () => {
    const decorated = decorateFields('<p>a {{X}} b</p>')
    expect(undecorateFields(decorated)).toBe('<p>a {{X}} b</p>')
  })

  it('keeps the style span execCommand puts INSIDE an unlocked chip', () => {
    const html =
      '<p><span class="ttg-chip" contenteditable="false" data-field="NOMBRE">' +
      '<span style="font-weight:700">{{NOMBRE}}</span></span></p>'
    expect(undecorateFields(html)).toBe('<p><span style="font-weight:700">{{NOMBRE}}</span></p>')
  })

  it('a styled literal round-trips: decorate re-chips inside the style span', () => {
    const storage = '<p><span style="font-weight:700">{{NOMBRE}}</span></p>'
    const decorated = decorateFields(storage)
    expect(decorated).toContain('ttg-chip')
    expect(decorated).toContain('font-weight:700')
    expect(undecorateFields(decorated)).toBe(storage)
  })

  it('keeps a style applied to the chip ELEMENT itself (chip-only selection)', () => {
    // Selecting exactly the chip makes Chromium restyle the chip span instead
    // of wrapping it — that style must be re-homed, not dropped.
    const html =
      '<p><span class="ttg-chip" contenteditable="false" data-field="nombre" ' +
      'style="font-weight: bold;">{{nombre}}</span></p>'
    expect(undecorateFields(html)).toBe(
      '<p><span style="font-weight: bold;">{{nombre}}</span></p>',
    )
  })

  it('combines own style and inner style spans', () => {
    const html =
      '<p><span class="ttg-chip" contenteditable="false" data-field="n" style="font-weight: bold;">' +
      '<span style="font-style:italic">{{n}}</span></span></p>'
    expect(undecorateFields(html)).toBe(
      '<p><span style="font-weight: bold;"><span style="font-style:italic">{{n}}</span></span></p>',
    )
  })

  it('removes the empty span left behind when a styled caret anchor is stripped', () => {
    const html =
      '<p><span style="font-weight:400">Mi nombre es ' +
      '<span class="ttg-chip" contenteditable="false" data-field="nombre" style="font-weight: bold;">{{nombre}}</span>' +
      `<span style="font-weight: bold;">${CARET_ANCHOR}</span></span></p>`
    expect(undecorateFields(html)).toBe(
      '<p><span style="font-weight:400">Mi nombre es <span style="font-weight: bold;">{{nombre}}</span></span></p>',
    )
  })

  it('a styled chip round-trips through decorate/undecorate', () => {
    const storage = '<p><span style="font-weight: bold;">{{nombre}}</span></p>'
    const decorated = decorateFields(storage)
    expect(decorated).toContain('ttg-chip')
    expect(undecorateFields(decorated)).toBe(storage)
  })

  it('a chip whose text no longer matches its field falls back to the literal', () => {
    const html =
      '<p><span class="ttg-chip" contenteditable="false" data-field="NOMBRE">' +
      '<span style="font-weight:700">roto</span></span></p>'
    expect(undecorateFields(html)).toBe('<p>{{NOMBRE}}</p>')
  })

  it('detects every field even across many text nodes (regex lastIndex)', () => {
    const decorated = decorateFields('<p>{{A}}</p><p>{{B}}</p><p>{{C}}</p>')
    expect(decorated.match(/ttg-chip/g)).toHaveLength(3)
  })
})

describe('normalizeBodyHtml (fingerprint stability)', () => {
  it('stays idempotent with caret anchors in play', () => {
    const html = '<p class="a">Hola {{ NOMBRE }}</p><p>{{OTRO}}</p>'
    const once = normalizeBodyHtml(html)
    expect(normalizeBodyHtml(once)).toBe(once)
    expect(once).not.toContain(CARET_ANCHOR)
  })

  it('is idempotent for styled fields too', () => {
    const html = '<p><span style="font-weight:700">{{NOMBRE}}</span> resto</p>'
    const once = normalizeBodyHtml(html)
    expect(normalizeBodyHtml(once)).toBe(once)
  })
})
