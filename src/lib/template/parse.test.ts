import { describe, expect, it } from 'vitest'
import { buildTemplate } from './parse'
import { resolveConditional } from '../engine/conditionals'

describe('walkBlocks empty-block handling', () => {
  it('keeps blank lines typed with Enter (<br> blocks)', () => {
    const html = '<p class="a">Hola</p><p class="a"><br></p><p class="a">Adiós</p>'
    const tpl = buildTemplate(html, '', 't', 'src')
    expect(tpl.blocks).toHaveLength(3)
    expect(tpl.blocks[1].html).toBe('<p class="a"><br></p>')
  })

  it('still skips Google-style empty spacer paragraphs (no <br>, no <img>)', () => {
    const html = '<p class="a">Hola</p><p class="b c"><span class="d"></span></p>'
    const tpl = buildTemplate(html, '', 't', 'src')
    expect(tpl.blocks).toHaveLength(1)
  })
})

describe('resolveConditional output styling', () => {
  const sub = { mapping: { NOMBRE: 'Nombre' }, onMissing: 'empty' as const }

  it('emits classless <p> per line so the doc base font applies', () => {
    const rule = {
      id: 'r',
      label: 'x',
      branches: [],
      defaultText: 'Hola {{NOMBRE}}\n\nSegundo párrafo',
    }
    expect(resolveConditional(rule, { Nombre: 'Ana' }, sub)).toBe(
      '<p>Hola Ana</p><p><br></p><p>Segundo párrafo</p>',
    )
  })

  it('escapes text before wrapping', () => {
    const rule = { id: 'r', label: 'x', branches: [], defaultText: '<b>no html</b>' }
    expect(resolveConditional(rule, {}, sub)).toBe('<p>&lt;b&gt;no html&lt;/b&gt;</p>')
  })

  it('renders sanitised rich branch content in the captured document font', () => {
    const rule = {
      id: 'r',
      label: 'x',
      branches: [],
      defaultText: 'Hola {{NOMBRE}}',
      defaultTextHtml:
        '<p style="text-align:right"><span style="font-style:italic">Hola {{NOMBRE}}</span></p>',
      textStyle: { fontFamily: 'Roboto', fontSize: '10pt' },
    }
    expect(resolveConditional(rule, { Nombre: 'Ana' }, sub)).toBe(
      '<div style="font-family:Roboto;font-size:10pt"><p style="text-align:right">' +
        '<span style="font-style:italic">Hola Ana</span></p></div>',
    )
  })
})
