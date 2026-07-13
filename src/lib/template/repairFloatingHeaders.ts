import { HTMLElement, parse } from 'node-html-parser'

const REPAIR_MARKER = '/*ttg-floating-header-repair*/'

const REPAIR_CSS = `${REPAIR_MARKER}
[data-ttg-layered-header="true"]{
  position:relative!important;display:block!important;
  width:var(--ttg-header-width)!important;max-width:100%!important;
  min-height:var(--ttg-header-height)!important;
  margin-left:0!important;margin-right:0!important;text-indent:0!important;
  white-space:normal!important;overflow:visible!important;
}
[data-ttg-layered-header="true"]>[data-ttg-header-layer]{
  position:absolute!important;margin:0!important;
}
[data-ttg-layered-header="true"]>[data-ttg-header-layer="background"]{
  z-index:1;left:0!important;right:auto!important;top:0!important;
}
[data-ttg-layered-header="true"]>[data-ttg-header-layer="logo"]{
  z-index:3;left:auto!important;right:8px!important;
  top:calc((var(--ttg-header-height) - var(--ttg-logo-height)) / 2)!important;
}
[data-ttg-layered-header="true"]>[data-ttg-header-layer="text"]{
  z-index:4;left:8px!important;right:calc(var(--ttg-logo-width) + 16px)!important;
  top:50%!important;transform:translateY(-50%)!important;
}
`

interface InlineImageLayer {
  element: HTMLElement
  width: number
  height: number
}

function px(style: string, property: string): number | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([0-9.]+)px`, 'i').exec(style)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

function imageLayer(element: HTMLElement): InlineImageLayer | null {
  if (element.rawTagName.toLowerCase() !== 'span' || !element.querySelector('img')) return null
  const style = element.getAttribute('style') ?? ''
  if (!/display\s*:\s*inline-block/i.test(style)) return null
  const width = px(style, 'width')
  const height = px(style, 'height')
  return width && height ? { element, width, height } : null
}

function appendStyle(element: HTMLElement, declarations: string): void {
  const current = element.getAttribute('style')?.trim() ?? ''
  element.setAttribute('style', `${current}${current && !current.endsWith(';') ? ';' : ''}${declarations}`)
}

/**
 * Google Docs flattens anchored header drawings into consecutive inline
 * spans. Detect the narrow, early-document pattern used by real headers and
 * restore its background/text/logo stacking for HTML editing.
 */
export function repairFloatingHeaders(input: {
  bodyHtml: string
  css: string
}): { bodyHtml: string; css: string; repaired: number } {
  const root = parse(`<div id="__repair_root">${input.bodyHtml}</div>`, { comment: false })
  const content = root.querySelector('#__repair_root')!
  // The public exporter sometimes wraps only the header in a leading <div>,
  // while authenticated exports may expose the <p> directly. Paragraph order
  // is stable across both forms, so inspect only the first eight paragraphs.
  const earlyElements = content.querySelectorAll('p').slice(0, 8)
  let repaired = 0

  for (const paragraph of earlyElements) {
    if (paragraph.getAttribute('data-ttg-layered-header') === 'true') continue
    const children = paragraph.childNodes.filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )
    const images = children.map(imageLayer).filter((layer): layer is InlineImageLayer => !!layer)
    const textLayers = children.filter(
      (element) => !element.querySelector('img') && element.textContent.trim().length > 0,
    )
    if (images.length < 2 || textLayers.length !== 1) continue

    const background = images.reduce((largest, layer) =>
      layer.width * layer.height > largest.width * largest.height ? layer : largest,
    )
    const logoCandidates = images.filter(
      (layer) => layer !== background && layer.width <= 160 && layer.width < background.width * 0.4,
    )
    if (background.width < 300 || logoCandidates.length !== 1) continue
    const logo = logoCandidates[0]

    paragraph.setAttribute('data-ttg-layered-header', 'true')
    appendStyle(
      paragraph,
      `--ttg-header-width:${background.width}px;--ttg-header-height:${background.height}px;` +
        `--ttg-logo-width:${logo.width}px;--ttg-logo-height:${logo.height}px;`,
    )
    background.element.setAttribute('data-ttg-header-layer', 'background')
    logo.element.setAttribute('data-ttg-header-layer', 'logo')
    textLayers[0].setAttribute('data-ttg-header-layer', 'text')
    repaired++
  }

  return {
    bodyHtml: content.innerHTML,
    css: repaired > 0 && !input.css.includes(REPAIR_MARKER) ? `${input.css}\n${REPAIR_CSS}` : input.css,
    repaired,
  }
}
