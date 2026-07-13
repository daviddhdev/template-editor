import { describe, expect, it } from 'vitest'
import { repairFloatingHeaders } from './repairFloatingHeaders'

const imageSpan = (width: number, height: number, alt = '') =>
  `<span style="overflow:hidden; display:inline-block; width:${width}px; height:${height}px"><img alt="${alt}" src="data:image/png;base64,AA"></span>`

describe('repairFloatingHeaders', () => {
  it('recomposes the real Google pattern as background, text and logo layers', () => {
    const bodyHtml = `<p class="header"><span class="title">FORMULARIO DE SOLICITUD</span>${imageSpan(
      605.22,
      40.73,
    )}${imageSpan(60.37, 35.91, 'LOGO')}</p><p>Contenido editable</p>`
    const result = repairFloatingHeaders({ bodyHtml, css: '.header{margin:0}' })

    expect(result.repaired).toBe(1)
    expect(result.bodyHtml).toContain('data-ttg-layered-header="true"')
    expect(result.bodyHtml).toContain('data-ttg-header-layer="background"')
    expect(result.bodyHtml).toContain('data-ttg-header-layer="logo"')
    expect(result.bodyHtml).toContain('data-ttg-header-layer="text"')
    expect(result.bodyHtml).toContain('--ttg-header-width:605.22px')
    expect(result.css).toContain('/*ttg-floating-header-repair*/')
    expect(result.css).toContain('right:8px!important')
  })

  it('is idempotent', () => {
    const first = repairFloatingHeaders({
      bodyHtml: `<p><span>Título</span>${imageSpan(600, 40)}${imageSpan(60, 30)}</p>`,
      css: '',
    })
    const second = repairFloatingHeaders(first)
    expect(second.bodyHtml).toBe(first.bodyHtml)
    expect(second.css).toBe(first.css)
    expect(second.repaired).toBe(0)
  })

  it('does not reposition ordinary inline images or ambiguous content', () => {
    const ordinary = repairFloatingHeaders({
      bodyHtml: `<p><span>Fotos</span>${imageSpan(120, 80)}${imageSpan(90, 80)}</p>`,
      css: '',
    })
    const ambiguous = repairFloatingHeaders({
      bodyHtml: `<p><span>Texto uno</span><span>Texto dos</span>${imageSpan(600, 40)}${imageSpan(
        60,
        30,
      )}</p>`,
      css: '',
    })
    expect(ordinary.repaired).toBe(0)
    expect(ambiguous.repaired).toBe(0)
    expect(ordinary.css).toBe('')
    expect(ambiguous.css).toBe('')
  })

  it('only inspects the beginning of the document', () => {
    const prefix = Array.from({ length: 8 }, (_, i) => `<p>Párrafo ${i}</p>`).join('')
    const lateHeader = `<p><span>Título</span>${imageSpan(600, 40)}${imageSpan(60, 30)}</p>`
    expect(repairFloatingHeaders({ bodyHtml: prefix + lateHeader, css: '' }).repaired).toBe(0)
  })
})
