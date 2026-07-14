// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { applyEditorFormat } from './DocCanvas'
import { undecorateFields } from '../lib/editorHtml'

describe('applyEditorFormat', () => {
  it('converts Chromium legacy font size output to the requested point size', () => {
    document.body.innerHTML = '<p><span style="font-size: xxx-large">Texto</span></p>'
    const span = document.querySelector('span')!
    const range = document.createRange()
    range.selectNodeContents(span)
    document.execCommand = vi.fn(() => true)

    applyEditorFormat(document, 'fontSizePt', '18.5', range, document.body)

    expect(document.execCommand).toHaveBeenCalledWith('fontSize', false, '7')
    expect(span.style.fontSize).toBe('18.5pt')
  })

  it('passes arbitrary colours to the browser formatting command', () => {
    document.body.innerHTML = '<p>Texto</p>'
    document.execCommand = vi.fn(() => true)
    applyEditorFormat(document, 'foreColor', '#123456', null, document.body)
    expect(document.execCommand).toHaveBeenCalledWith('foreColor', false, '#123456')
  })

  it('preserves an exact size when the selection contains a variable chip', () => {
    document.body.innerHTML =
      '<p><span class="ttg-chip" contenteditable="false" data-field="NOMBRE">' +
      '<span style="font-size: xxx-large">{{NOMBRE}}</span></span></p>'
    const styled = document.querySelector<HTMLElement>('.ttg-chip span')!
    const range = document.createRange()
    range.selectNodeContents(styled)
    document.execCommand = vi.fn(() => true)

    applyEditorFormat(document, 'fontSizePt', '16', range, document.body)

    expect(undecorateFields(document.body.innerHTML)).toBe(
      '<p><span style="font-size: 16pt;">{{NOMBRE}}</span></p>',
    )
  })
})
