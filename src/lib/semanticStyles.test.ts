import { describe, expect, it } from 'vitest'
import { emphasizeInlineStyles } from './semanticStyles'

describe('emphasizeInlineStyles', () => {
  it('wraps inline bold styles in <b> (Google importer drops the CSS)', () => {
    const html = '<p><span style="font-weight: bold;">Hola Ana</span></p>'
    expect(emphasizeInlineStyles(html)).toBe(
      '<p><span style="font-weight: bold;"><b>Hola Ana</b></span></p>',
    )
  })

  it('covers numeric weights, italic, underline and strike', () => {
    const html =
      '<p><span style="font-weight:700">a</span>' +
      '<span style="font-style:italic">b</span>' +
      '<span style="text-decoration: underline">c</span>' +
      '<span style="text-decoration-line: line-through">d</span></p>'
    const out = emphasizeInlineStyles(html)
    expect(out).toContain('<b>a</b>')
    expect(out).toContain('<i>b</i>')
    expect(out).toContain('<u>c</u>')
    expect(out).toContain('<s>d</s>')
  })

  it('combines several properties on one element', () => {
    const html = '<span style="font-weight:bold;font-style:italic">x</span>'
    expect(emphasizeInlineStyles(html)).toBe(
      '<span style="font-weight:bold;font-style:italic"><b><i>x</i></b></span>',
    )
  })

  it('leaves normal weights and unstyled markup alone', () => {
    const html = '<p><span style="font-weight:400">a</span><span>b</span></p>'
    expect(emphasizeInlineStyles(html)).toBe(html)
  })

  it('keeps nested content (a field inside a bold span) intact', () => {
    const html = '<p><span style="font-weight: bold;">Hola {{nombre}} fin</span></p>'
    expect(emphasizeInlineStyles(html)).toBe(
      '<p><span style="font-weight: bold;"><b>Hola {{nombre}} fin</b></span></p>',
    )
  })
})
