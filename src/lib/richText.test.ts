import { describe, expect, it } from 'vitest'
import {
  bindingsHaveRichFormatting,
  conditionalTextStyleCss,
  normalizeRichText,
  renderRichText,
  richTextToPlainText,
  sanitizeConditionalTextStyle,
  sanitizeRichText,
} from './richText'

describe('rich rule text', () => {
  it('normalises the contenteditable HTML and keeps only supported formatting', () => {
    const input =
      '<div style="text-align:center;color:red"><strong>Hola</strong>' +
      '<script>alert(1)</script><span class="x" style="font-style:italic;background:url(x)"> {{N}}</span></div>'
    expect(sanitizeRichText(input)).toBe(
      '<p style="text-align:center"><span style="font-weight:bold">Hola</span>' +
        '<span style="font-style:italic"> {{N}}</span></p>',
    )
  })

  it('keeps plain text authoritative and omits HTML when no format remains', () => {
    expect(normalizeRichText('<div>Uno</div><div>Dos<br>tres</div>')).toEqual({
      text: 'Uno\nDos\ntres',
    })
    expect(normalizeRichText('<p><span style="font-weight:normal">Plano</span></p>')).toEqual({
      text: 'Plano',
    })
  })

  it('retains rich HTML only for meaningful emphasis/alignment', () => {
    expect(normalizeRichText('<p style="text-align:right"><b>Importante</b></p>')).toEqual({
      text: 'Importante',
      html: '<p style="text-align:right"><span style="font-weight:bold">Importante</span></p>',
    })
  })

  it('renders aligned anchored content without nesting paragraphs in a span', () => {
    const inline = renderRichText(
      '<p style="text-align:center"><i>Hola</i></p>',
      'inline',
      { fontFamily: 'Arial', fontSize: '11pt' },
    )
    expect(inline).toBe(
      '<span style="font-family:Arial;font-size:11pt">' +
        '<span style="display:block;text-align:center"><span style="font-style:italic">Hola</span></span>' +
        '</span>',
    )
    expect(inline).not.toContain('<p')
  })

  it('keeps a single unaligned rich replacement inline', () => {
    expect(renderRichText('<p><b>Importante</b></p>', 'inline')).toBe(
      '<span style="font-weight:bold">Importante</span>',
    )
  })

  it('preserves blank lines and rejects unsafe inherited CSS values', () => {
    expect(richTextToPlainText('<p>Uno</p><p><br></p><p>Tres</p>')).toBe('Uno\n\nTres')
    expect(
      sanitizeConditionalTextStyle({
        fontFamily: 'Arial; background:url(https://bad)',
        fontSize: '11pt',
        lineHeight: '1.2',
        color: 'rgb(1, 2, 3)',
      }),
    ).toEqual({ fontSize: '11pt', lineHeight: '1.2', color: 'rgb(1, 2, 3)' })
    expect(conditionalTextStyleCss({ fontFamily: 'Arial', fontSize: '11pt' })).toBe(
      'font-family:Arial;font-size:11pt',
    )
  })

  it('detects rich formatting in any bound branch/default', () => {
    expect(
      bindingsHaveRichFormatting({
        TAG: {
          perRow: false,
          rule: {
            id: 'r',
            label: 'R',
            branches: [
              {
                id: 'b',
                column: 'C',
                operator: 'equals',
                value: 'x',
                text: 'Hola',
              },
            ],
            defaultText: '',
            defaultTextHtml: '<p style="text-align:center">Nada</p>',
          },
        },
      }),
    ).toBe(true)
    expect(bindingsHaveRichFormatting({})).toBe(false)
  })
})
