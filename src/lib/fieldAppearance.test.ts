// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { decorateFields, undecorateFields } from './editorHtml'
import {
  colorToHex,
  documentTextColors,
  readFieldAppearance,
  setFieldAppearance,
} from './fieldAppearance'

function editor(html: string): { root: HTMLElement; chips: HTMLElement[] } {
  const root = document.createElement('div')
  root.style.fontSize = '16px'
  root.style.color = 'rgb(17, 34, 51)'
  root.innerHTML = decorateFields(html)
  document.body.replaceChildren(root)
  return { root, chips: [...root.querySelectorAll<HTMLElement>('.ttg-chip')] }
}

describe('field appearance', () => {
  it('styles one occurrence and round-trips it through storage', () => {
    const { root, chips } = editor('<p>{{NOMBRE}} y {{NOMBRE}}</p>')
    setFieldAppearance(chips[1], { fontSizePt: 14, colorHex: '#AABBCC' })
    const stored = undecorateFields(root.innerHTML)
    expect(stored).toBe(
      '<p>{{NOMBRE}} y <span data-ttg-field-style="" style="font-size: 14pt; color: rgb(170, 187, 204);">{{NOMBRE}}</span></p>',
    )
    expect(undecorateFields(decorateFields(stored))).toBe(stored)
  })

  it('resets properties independently and unwraps when both inherit', () => {
    const { root, chips } = editor('<p>{{CAMPO}}</p>')
    setFieldAppearance(chips[0], { fontSizePt: 18, colorHex: '#FF0000' })
    expect(readFieldAppearance(chips[0])).toMatchObject({ fontSizePt: 18, colorHex: '#FF0000' })
    setFieldAppearance(chips[0], { fontSizePt: null })
    expect(readFieldAppearance(chips[0])).toMatchObject({ fontSizePt: null, colorHex: '#FF0000' })
    setFieldAppearance(chips[0], { colorHex: null })
    expect(undecorateFields(root.innerHTML)).toBe('<p>{{CAMPO}}</p>')
  })

  it('normalises opaque colours and ranks document colours by text volume', () => {
    expect(colorToHex('#abc')).toBe('#AABBCC')
    expect(colorToHex('rgba(1, 2, 3, 0.5)')).toBeNull()
    const { root } = editor('<p><span style="color:#ff0000">Texto largo</span><span style="color:rgb(0, 0, 255)">x</span></p>')
    expect(documentTextColors(root.ownerDocument).slice(0, 2)).toEqual(['#FF0000', '#0000FF'])
  })
})
