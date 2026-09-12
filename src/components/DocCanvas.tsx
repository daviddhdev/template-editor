import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { useWorkspace } from '../state/workspaceStore'
import {
  applyCondToElement,
  buildEditorDocument,
  CARET_ANCHOR,
  decorateFields,
  decorateTextNodeLive,
  isAnchorText,
  makeCondElement,
  makeFieldChip,
  undecorateFields,
} from '../lib/editorHtml'
import { decodeCond } from '../lib/cond'
import { effectiveMapping } from '../lib/plan'
import {
  colorToHex,
  documentTextColors,
} from '../lib/fieldAppearance'
import { sanitizeConditionalTextStyle } from '../lib/richText'
import { uid } from '../lib/uid'
import type { ConditionalRule, ConditionalTextStyle } from '../types'
import { BindFieldPopover } from './BindFieldPopover'
import { CondEditor, type RichTextSelection } from './CondEditor'
import { FORMAT_LABEL, FormatToolbar, type ToolbarTextStyle } from './FormatToolbar'
import { MarginRuler } from './MarginRuler'
import { Button, ConfirmDialog } from './ui'

export const DRAG_MIME = 'text/ttg-column'
export const COND_MIME = 'text/ttg-cond'

// Keep the drag marker outside body.innerHTML so it is never persisted.
function dropMarker(doc: Document): HTMLElement {
  let m = doc.getElementById('ttg-drop-caret')
  if (!m) {
    m = doc.createElement('div')
    m.id = 'ttg-drop-caret'
    m.className = 'ttg-drop-caret'
    doc.documentElement.appendChild(m)
  }
  return m
}

function hideDropMarker(doc: Document): void {
  const m = doc.getElementById('ttg-drop-caret')
  if (m) m.style.display = 'none'
}

function showDropMarker(doc: Document, r: Range): void {
  // A collapsed range may have no rect; probe one character around it.
  let rect: DOMRect | undefined
  let x: number | undefined
  const probe = r.cloneRange()
  if (probe.startContainer.nodeType === Node.TEXT_NODE) {
    const t = probe.startContainer as Text
    if (probe.startOffset < t.length) {
      probe.setEnd(t, probe.startOffset + 1)
      rect = probe.getClientRects()[0]
      x = rect?.left
    } else if (probe.startOffset > 0) {
      probe.setStart(t, probe.startOffset - 1)
      rect = probe.getClientRects()[0]
      x = rect?.right
    }
  }
  if (!rect) {
    rect = r.getClientRects()[0]
    x = rect?.left
  }
  if (!rect) {
    const el = (
      r.startContainer.nodeType === Node.ELEMENT_NODE
        ? r.startContainer
        : r.startContainer.parentElement
    ) as Element | null
    if (!el) return
    rect = el.getBoundingClientRect()
    x = rect.left
  }
  const win = doc.defaultView
  const m = dropMarker(doc)
  m.style.display = 'block'
  m.style.left = `${(x ?? rect.left) + (win?.scrollX ?? 0) - 1}px`
  m.style.top = `${rect.top + (win?.scrollY ?? 0)}px`
  m.style.height = `${rect.height || 16}px`
}

/** Chip beside the caret, if any; Chromium needs explicit chip deletion. */
function chipBesideCaret(node: Node, offset: number, dir: 'back' | 'fwd'): HTMLElement | null {
  let probe: Node | null
  if (node.nodeType === Node.TEXT_NODE) {
    const data = (node as Text).data
    const rest = dir === 'back' ? data.slice(0, offset) : data.slice(offset)
    if (rest.split(CARET_ANCHOR).join('') !== '') return null
    probe = dir === 'back' ? node.previousSibling : node.nextSibling
  } else {
    const kids = node.childNodes
    probe = dir === 'back' ? (kids[offset - 1] ?? null) : (kids[offset] ?? null)
  }
  while (probe && isAnchorText(probe)) {
    probe = dir === 'back' ? probe.previousSibling : probe.nextSibling
  }
  const el = probe && probe.nodeType === Node.ELEMENT_NODE ? (probe as HTMLElement) : null
  if (!el) return null
  if (el.classList.contains('ttg-chip')) return el
  return el.hasAttribute('data-ttg-field-style') ? el.querySelector<HTMLElement>(':scope > .ttg-chip') : null
}

function removeChip(chip: HTMLElement): void {
  const styleWrapper = chip.closest<HTMLElement>('[data-ttg-field-style]')
  const next = styleWrapper?.nextSibling ?? chip.nextSibling
  if (next && isAnchorText(next)) next.remove()
  else if (next && next.nodeType === Node.TEXT_NODE) {
    ;(next as Text).data = (next as Text).data.replace(new RegExp(`^${CARET_ANCHOR}+`), '')
  }
  chip.remove()
  if (styleWrapper && !styleWrapper.textContent) styleWrapper.remove()
}

// Firefox exposes caretPositionFromPoint instead of caretRangeFromPoint.
function rangeFromPoint(doc: Document, x: number, y: number): Range | null {
  if (typeof doc.caretRangeFromPoint === 'function') {
    return doc.caretRangeFromPoint(x, y)
  }
  const pos = (
    doc as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
  ).caretPositionFromPoint?.(x, y)
  if (!pos) return null
  const r = doc.createRange()
  try {
    r.setStart(pos.offsetNode, pos.offset)
  } catch {
    return null
  }
  r.collapse(true)
  return r
}

function textStyleSource(el: HTMLElement): HTMLElement {
  // Chip styling is editor chrome; inherit typography from its source run.
  if (el.classList.contains('ttg-chip')) return el.parentElement ?? el
  const runs = Array.from(el.querySelectorAll<HTMLElement>('span[class], span[style]')).filter(
    (run) => !run.closest('.ttg-chip, .ttg-cond'),
  )
  return runs.at(-1) ?? el
}

function capturedTextStyle(el: HTMLElement | null): ConditionalTextStyle | undefined {
  if (!el) return undefined
  const source = textStyleSource(el)
  const win = source.ownerDocument.defaultView
  if (!win) return undefined
  const computed = win.getComputedStyle(source)
  return sanitizeConditionalTextStyle({
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    lineHeight: computed.lineHeight,
    color: computed.color,
  })
}

function toolbarStyleAt(doc: Document, range: Range | null): ToolbarTextStyle {
  let node: Node | null = range?.startContainer ?? doc.body
  if (node.nodeType === Node.ELEMENT_NODE && range && (node as Element).childNodes[range.startOffset]) {
    node = (node as Element).childNodes[range.startOffset]
  }
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
  const computed = doc.defaultView?.getComputedStyle(element ?? doc.body)
  const px = Number.parseFloat(computed?.fontSize ?? '')
  return {
    fontSizePt: Number.isFinite(px) ? Math.round(px * 0.75 * 100) / 100 : 11,
    colorHex: colorToHex(computed?.color) ?? '#000000',
  }
}

export function applyEditorFormat(
  doc: Document,
  command: string,
  value: string | undefined,
  range: Range | null,
  root: HTMLElement,
): void {
  if (command !== 'fontSizePt') {
    doc.execCommand(command, false, value)
    return
  }
  doc.execCommand('fontSize', false, '7')
  if (!range || !value) return
  for (const el of root.querySelectorAll<HTMLElement>('span[style],font[style],font[size="7"]')) {
    if (!range.intersectsNode(el)) continue
    const legacy = el.getAttribute('size') === '7'
    const css = el.style.fontSize.toLowerCase()
    if (!legacy && css !== 'xxx-large' && css !== '-webkit-xxx-large') continue
    el.removeAttribute('size')
    el.style.fontSize = `${value}pt`
  }
}

function applyCapturedTextStyle(
  el: HTMLElement,
  style: ConditionalTextStyle | undefined,
): boolean {
  if (!style) return false
  let changed = false
  if (style.fontFamily && !el.style.fontFamily) {
    el.style.fontFamily = style.fontFamily
    changed = true
  }
  if (style.fontSize && !el.style.fontSize) {
    el.style.fontSize = style.fontSize
    changed = true
  }
  if (style.lineHeight && !el.style.lineHeight) {
    el.style.lineHeight = style.lineHeight
    changed = true
  }
  if (style.color && !el.style.color) {
    el.style.color = style.color
    changed = true
  }
  return changed
}

function adjacentContent(el: HTMLElement, direction: 'previous' | 'next'): HTMLElement | null {
  let candidate =
    direction === 'previous'
      ? (el.previousElementSibling as HTMLElement | null)
      : (el.nextElementSibling as HTMLElement | null)
  if (!candidate && el.parentElement?.getAttribute('data-ttg-repeat') === 'true') {
    const wrapper = el.parentElement
    candidate =
      direction === 'previous'
        ? (wrapper.previousElementSibling as HTMLElement | null)
        : (wrapper.nextElementSibling as HTMLElement | null)
  }
  while (candidate?.classList.contains('ttg-cond')) {
    candidate =
      direction === 'previous'
        ? (candidate.previousElementSibling as HTMLElement | null)
        : (candidate.nextElementSibling as HTMLElement | null)
  }
  if (candidate?.getAttribute('data-ttg-repeat') === 'true') {
    return (direction === 'previous' ? candidate.lastElementChild : candidate.firstElementChild) as
      | HTMLElement
      | null
  }
  return candidate
}

function nearbyTextStyle(el: HTMLElement): ConditionalTextStyle | undefined {
  return (
    capturedTextStyle(adjacentContent(el, 'previous')) ??
    capturedTextStyle(adjacentContent(el, 'next')) ??
    capturedTextStyle(el.ownerDocument.body)
  )
}

export interface DocCanvasHandle {
  insertField: (name: string) => void
  toggleRepeat: () => void
  insertConditional: () => void
  openRuleEditor: (tag: string) => void
}

export const DocCanvas = forwardRef<DocCanvasHandle, { className?: string }>(function DocCanvas(
  { className = '' },
  ref,
) {
  const {
    editorHtml,
    editorCss,
    editorBodyClass,
    docToken,
    data,
    mapping,
    ruleBindings,
    tagFormats,
    setEditorHtml,
    assign,
    bindRule,
    unbindRule,
    setTagFormat,
  } = useWorkspace()

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const savedRange = useRef<Range | null>(null)
  const richFormatTarget = useRef<RichTextSelection | null>(null)
  const [bindTag, setBindTag] = useState<{ tag: string; el: HTMLElement } | null>(null)
  const [bindingRule, setBindingRule] = useState<{
    tag: string
    rule: ConditionalRule
    perRow: boolean
    existing: boolean
  } | null>(null)
  const [editingCond, setEditingCond] = useState<{ el: HTMLElement; rule: ConditionalRule } | null>(
    null,
  )
  const startBlankDocument = useCallback(() => {
    useWorkspace.getState().loadRawDocument({
      title: 'Documento',
      css: 'body{background-color:#ffffff;max-width:451.3pt;padding:72pt;font-family:Arial;font-size:11pt;color:#000000;}\np{margin:0;line-height:1.15;}',
      bodyClass: '',
      bodyHtml: '<p><br></p>',
    })
  }, [])
  const [askGroupMode, setAskGroupMode] = useState(false)
  const [fmt, setFmt] = useState<Record<string, boolean>>({})
  const [toolbarTextStyle, setToolbarTextStyle] = useState<ToolbarTextStyle>({
    fontSizePt: 11,
    colorHex: '#000000',
  })
  const [templateColors, setTemplateColors] = useState<string[]>(['#000000'])

  const editorDoc = () => iframeRef.current?.contentDocument ?? null
  const editorWin = () => iframeRef.current?.contentWindow ?? null

  const refreshBindings = useCallback(() => {
    const doc = editorDoc()
    if (!doc) return
    const columns = useWorkspace.getState().data?.columns ?? []
    const explicit = useWorkspace.getState().mapping
    const rules = useWorkspace.getState().ruleBindings
    doc.body.querySelectorAll<HTMLElement>('.ttg-chip').forEach((chip) => {
      const tag = chip.dataset.field ?? ''
      const eff = effectiveMapping([tag], columns, explicit)[tag]
      const rule = rules[tag]
      chip.classList.toggle('ttg-rulebound', Boolean(rule))
      chip.classList.toggle('ttg-unbound', !eff && !rule)
      chip.title = rule
        ? `Se rellena con la regla «${rule.rule.label}»`
        : eff
          ? `Se rellena con la columna «${eff}»`
          : 'Sin vincular — haz clic para elegir una columna'
    })
  }, [])

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback(() => {
    if (persistTimer.current !== null) {
      clearTimeout(persistTimer.current)
      persistTimer.current = null
    }
    const body = editorDoc()?.body
    if (body) setEditorHtml(undecorateFields(body.innerHTML))
    refreshBindings()
  }, [setEditorHtml, refreshBindings])

  // Debounce serialization of large bodies; history coalesces independently.
  const schedulePersist = useCallback(() => {
    if (persistTimer.current !== null) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(persist, 300)
  }, [persist])

  const flushPersist = useCallback(() => {
    if (persistTimer.current !== null) persist()
  }, [persist])

  const checkpointFlushed = useCallback(
    (label: string) => {
      flushPersist()
      useWorkspace.getState().checkpoint(label)
    },
    [flushPersist],
  )

  useEffect(() => flushPersist, [flushPersist])

  // Copy nearby Google font classes into newly typed, classless blocks.
  const inheritTypedBlockStyle = useCallback(() => {
    const doc = editorDoc()
    const sel = doc?.defaultView?.getSelection()
    if (!doc || !sel?.anchorNode) return
    const isRepeatWrapper = (n: Node | null): boolean =>
      !!n &&
      n.nodeType === Node.ELEMENT_NODE &&
      (n as HTMLElement).getAttribute('data-ttg-repeat') === 'true'

    // Walk through repeat wrappers so marked sections inherit document styles.
    let node: Node | null = sel.anchorNode
    while (node && node.parentNode !== doc.body && !isRepeatWrapper(node.parentNode)) {
      node = node.parentNode
    }
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return
    const block = node as HTMLElement
    const tag = block.tagName.toLowerCase()
    if ((tag !== 'p' && tag !== 'div') || block.className || block.hasAttribute('data-cond')) return
    if (isRepeatWrapper(block)) return

    // Prefer nearby content; computed style is a fallback for CSS-only fonts.
    const reference = adjacentContent(block, 'previous') ?? adjacentContent(block, 'next')
    if (reference?.className) block.className = reference.className
    if (!block.getAttribute('style') && reference?.getAttribute('style')) {
      block.setAttribute('style', reference.getAttribute('style')!)
    }
    applyCapturedTextStyle(
      block,
      capturedTextStyle(reference) ??
        capturedTextStyle(isRepeatWrapper(block.parentElement) ? block.parentElement : doc.body),
    )

    // Public exports use classes; Drive API exports use inline styles.
    const refSpan = Array.from(
      reference?.querySelectorAll<HTMLElement>('span[class], span[style]') ?? [],
    )
      .filter((s) => !s.classList.contains('ttg-chip'))
      .pop()
    if (!refSpan) return
    const caret = { node: sel.anchorNode, offset: sel.anchorOffset }
    for (const child of Array.from(block.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        const span = doc.createElement('span')
        if (refSpan.className) span.className = refSpan.className
        const st = refSpan.getAttribute('style')
        if (st) span.setAttribute('style', st)
        child.replaceWith(span)
        span.appendChild(child)
      }
    }
    try {
      sel.collapse(caret.node, caret.offset)
    } catch {
    }
  }, [])

  // Chip-ify complete tags as they are typed; decorateFields runs only on load.
  const liveDecorateFields = useCallback(() => {
    const doc = editorDoc()
    const sel = doc?.defaultView?.getSelection()
    if (!doc || !sel?.anchorNode) return
    let node: Node | null = sel.anchorNode
    while (node && node.parentNode !== doc.body) node = node.parentNode
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return
    const block = node as HTMLElement
    if (block.classList.contains('ttg-cond')) return

    const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    const texts: Text[] = []
    let n: Node | null
    while ((n = walker.nextNode())) {
      const t = n as Text
      if (t.parentElement?.closest('.ttg-chip, .ttg-cond')) continue
      texts.push(t)
    }
    const caretNode = sel.anchorNode
    for (const t of texts) {
      const hadCaret = t === caretNode
      const last = decorateTextNodeLive(t, doc)
      if (last && hadCaret) {
        const r = doc.createRange()
        r.setStartAfter(last)
        r.collapse(true)
        sel.removeAllRanges()
        sel.addRange(r)
      }
    }
  }, [])

  const saveSelection = useCallback(() => {
    const win = editorWin()
    const doc = editorDoc()
    const sel = win?.getSelection()
    if (sel && sel.rangeCount && doc?.body.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      savedRange.current = sel.getRangeAt(0).cloneRange()
    }
  }, [])

  const cursorRange = useCallback((): Range | null => {
    const doc = editorDoc()
    const win = editorWin()
    if (!doc || !win) return null
    const sel = win.getSelection()
    if (savedRange.current) {
      sel?.removeAllRanges()
      sel?.addRange(savedRange.current)
    }
    let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
    if (!range || !doc.body.contains(range.commonAncestorContainer)) {
      range = doc.createRange()
      range.selectNodeContents(doc.body)
      range.collapse(false)
    }
    return range
  }, [])

  const refreshFmt = useCallback(() => {
    const rich = richFormatTarget.current
    const doc = rich?.element.isConnected ? rich.element.ownerDocument : editorDoc()
    if (!doc) return
    const states: Record<string, boolean> = {}
    for (const cmd of ['bold', 'italic', 'underline', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull']) {
      try {
        states[cmd] = doc.queryCommandState(cmd)
      } catch {
        states[cmd] = false
      }
    }
    setFmt(states)
    const selection = doc.defaultView?.getSelection()
    const range = rich?.element.isConnected
      ? rich.range
      : selection?.rangeCount
        ? selection.getRangeAt(0)
        : savedRange.current
    setToolbarTextStyle(toolbarStyleAt(doc, range ?? null))
  }, [])

  const handleRichSelection = useCallback(
    (selection: RichTextSelection | null) => {
      richFormatTarget.current = selection
      refreshFmt()
    },
    [refreshFmt],
  )

  const execFormat = useCallback(
    (command: string, value?: string) => {
      const rich = richFormatTarget.current
      if (rich?.element.isConnected) {
        const doc = rich.element.ownerDocument
        const win = doc.defaultView
        const sel = win?.getSelection()
        if (!win || !sel) return
        rich.element.focus()
        sel.removeAllRanges()
        sel.addRange(rich.range)
        try {
          doc.execCommand('styleWithCSS', false, 'true')
        } catch {
        }
        applyEditorFormat(doc, command, value, rich.range, rich.element)
        if (sel.rangeCount) rich.range = sel.getRangeAt(0).cloneRange()
        rich.sync()
        refreshFmt()
        return
      }

      const doc = editorDoc()
      const win = editorWin()
      if (!doc || !win) return
      checkpointFlushed(FORMAT_LABEL[command] ?? 'Formato')
      win.focus()
      doc.body.focus()
      const sel = win.getSelection()
      if (savedRange.current) {
        sel?.removeAllRanges()
        sel?.addRange(savedRange.current)
      }

      // Temporarily unlock chips: Chromium skips non-editable nodes in ranges.
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
      if (range) {
        const chipOf = (node: Node): HTMLElement | null => {
          const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
          return (el?.closest?.('.ttg-chip') as HTMLElement | null) ?? null
        }
        const startChip = chipOf(range.startContainer)
        const endChip = chipOf(range.endContainer)
        if (startChip) range.setStartBefore(startChip)
        if (endChip) range.setEndAfter(endChip)
        for (const chip of doc.body.querySelectorAll<HTMLElement>('.ttg-chip')) {
          if (range.intersectsNode(chip)) chip.removeAttribute('contenteditable')
        }
      }

      applyEditorFormat(doc, command, value, range, doc.body)

      for (const chip of doc.body.querySelectorAll<HTMLElement>('.ttg-chip')) {
        chip.setAttribute('contenteditable', 'false')
      }

      // Google paragraph indents otherwise offset centered text on the page.
      if (command === 'justifyCenter') {
        const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null
        if (r) {
          for (const el of doc.body.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li')) {
            if (!r.intersectsNode(el)) continue
            el.style.textIndent = '0'
            el.style.marginLeft = '0'
            el.style.marginRight = '0'
          }
        }
      }

      if (sel && sel.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange()
      persist()
      setTemplateColors(documentTextColors(doc))
      refreshFmt()
    },
    [checkpointFlushed, persist, refreshFmt],
  )

  const insertFieldAtRange = useCallback(
    (name: string, range: Range): HTMLElement | null => {
      const doc = editorDoc()
      const win = editorWin()
      const clean = name.trim()
      if (!doc || !win || !clean) return null
      range.deleteContents()
      const chip = makeFieldChip(clean, doc)
      const space = doc.createTextNode(' ')
      range.insertNode(space)
      range.insertNode(chip)
      range.setStartAfter(space)
      range.collapse(true)
      const sel = win.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      savedRange.current = range.cloneRange()
      persist()
      return chip
    },
    [persist],
  )

  const topBlockOf = useCallback((start: Node | null): HTMLElement | null => {
    const doc = editorDoc()
    if (!doc || !start) return null
    let node: Node | null = start
    while (node && node.parentNode !== doc.body) node = node.parentNode
    return node && node.nodeType === 1 ? (node as HTMLElement) : null
  }, [])

  const boundaryNode = useCallback((container: Node, offset: number, end = false): Node | null => {
    const doc = editorDoc()
    if (!doc || container !== doc.body) return container
    const kids = doc.body.childNodes
    if (kids.length === 0) return null
    const idx = end && offset > 0 ? offset - 1 : Math.min(offset, kids.length - 1)
    return kids[idx] ?? null
  }, [])

  const cursorBlock = useCallback((): HTMLElement | null => {
    const range = cursorRange()
    if (!range) return null
    return topBlockOf(boundaryNode(range.startContainer, range.startOffset))
  }, [cursorRange, topBlockOf, boundaryNode])

  const toggleRepeat = useCallback(() => {
    const doc = editorDoc()
    const range = cursorRange()
    if (!doc || !range) return
    const startBlock = topBlockOf(boundaryNode(range.startContainer, range.startOffset))
    const endBlock = topBlockOf(boundaryNode(range.endContainer, range.endOffset, true))
    if (!startBlock) return
    const repeatStyle = startBlock.classList.contains('ttg-cond')
      ? nearbyTextStyle(startBlock)
      : capturedTextStyle(startBlock)
    checkpointFlushed('Sección repetible')

    // Repeat markers only affect grouped output; avoid silently ignoring them.
    const marksNew =
      startBlock.getAttribute('data-ttg-repeat') !== 'true' ||
      (endBlock && endBlock !== startBlock)

    if (endBlock && endBlock !== startBlock) {
      const wrapper = doc.createElement('div')
      wrapper.setAttribute('data-ttg-repeat', 'true')
      applyCapturedTextStyle(wrapper, repeatStyle)
      doc.body.insertBefore(wrapper, startBlock)
      let node: Node | null = startBlock
      while (node) {
        const next: Node | null = node === endBlock ? null : node.nextSibling
        wrapper.appendChild(node)
        node = next
      }
      persist()
    } else {
      const el = startBlock
      if (el.getAttribute('data-ttg-repeat') === 'true') {
        if (el.tagName === 'DIV' && el.children.length > 0 && !el.getAttribute('data-cond')) {
          const wrapperStyle = sanitizeConditionalTextStyle({
            fontFamily: el.style.fontFamily,
            fontSize: el.style.fontSize,
            lineHeight: el.style.lineHeight,
            color: el.style.color,
          })
          while (el.firstChild) {
            if (el.firstChild.nodeType === Node.ELEMENT_NODE) {
              applyCapturedTextStyle(el.firstChild as HTMLElement, wrapperStyle)
            }
            doc.body.insertBefore(el.firstChild, el)
          }
          el.remove()
        } else {
          el.removeAttribute('data-ttg-repeat')
        }
      } else {
        // Wrap a single block so its Google paragraph geometry stays intact.
        const wrapper = doc.createElement('div')
        wrapper.setAttribute('data-ttg-repeat', 'true')
        applyCapturedTextStyle(wrapper, repeatStyle)
        doc.body.insertBefore(wrapper, el)
        wrapper.appendChild(el)
      }
      persist()
    }

    if (marksNew && useWorkspace.getState().group.mode === 'per_row') {
      setAskGroupMode(true)
    }
  }, [cursorRange, topBlockOf, boundaryNode, checkpointFlushed, persist])

  const freshRule = useCallback((textStyle?: ConditionalTextStyle): ConditionalRule => {
    const columns = useWorkspace.getState().data?.columns ?? []
    return {
      id: uid(),
      label: 'Texto condicional',
      branches: [{ id: uid(), column: columns[0] ?? '', operator: 'equals', value: '', text: '' }],
      defaultText: '',
      ...(textStyle ? { textStyle } : {}),
    }
  }, [])

  const insertCondAfter = useCallback(
    (after: HTMLElement | null) => {
      const doc = editorDoc()
      if (!doc) return
      checkpointFlushed('Texto condicional añadido')
      const textStyle = after
        ? after.classList.contains('ttg-cond')
          ? nearbyTextStyle(after)
          : capturedTextStyle(after)
        : capturedTextStyle(doc.body)
      const rule = freshRule(textStyle)
      const el = makeCondElement(rule, doc)
      if (after) after.insertAdjacentElement('afterend', el)
      else doc.body.appendChild(el)
      persist()
      setEditingCond({ el, rule })
    },
    [checkpointFlushed, freshRule, persist],
  )

  const openRuleEditor = useCallback(
    (tag: string) => {
      const doc = editorDoc()
      if (!doc) return
      const chip = Array.from(doc.body.querySelectorAll<HTMLElement>('.ttg-chip')).find(
        (candidate) => candidate.dataset.field === tag,
      )
      const existing = useWorkspace.getState().ruleBindings[tag]
      const textStyle = capturedTextStyle(chip ?? doc.body)
      const rule = existing?.rule ?? freshRule(textStyle)
      setBindingRule({
        tag,
        rule: rule.textStyle || !textStyle ? rule : { ...rule, textStyle },
        perRow: existing?.perRow ?? false,
        existing: Boolean(existing),
      })
    },
    [freshRule],
  )

  useImperativeHandle(
    ref,
    (): DocCanvasHandle => ({
      insertField: (name) => {
        editorWin()?.focus()
        editorDoc()?.body.focus()
        checkpointFlushed(`Campo «${name.trim()}»`)
        const hadCursor = !!savedRange.current
        const range = cursorRange()
        if (!range) return
        const chip = insertFieldAtRange(name, range)
        if (chip && !hadCursor) {
          chip.scrollIntoView({ block: 'center' })
          useWorkspace.getState().notify('No había cursor en el documento: campo añadido al final.')
        }
      },
      toggleRepeat,
      insertConditional: () => insertCondAfter(cursorBlock()),
      openRuleEditor,
    }),
    [
      checkpointFlushed,
      cursorRange,
      insertFieldAtRange,
      toggleRepeat,
      insertCondAfter,
      cursorBlock,
      openRuleEditor,
    ],
  )

  useEffect(() => {
    const doc = editorDoc()
    if (!doc) return
    doc.open()
    doc.write(buildEditorDocument(editorCss, editorBodyClass, decorateFields(editorHtml || '')))
    doc.close()
    const body = doc.body
    setTemplateColors(documentTextColors(doc))

    try {
      doc.execCommand('styleWithCSS', false, 'true')
      doc.execCommand('defaultParagraphSeparator', false, 'p')
    } catch {
    }

    // Repair old recipes missing rich rule context or paragraph classes.
    let repairedStyleContext = false
    for (const cond of body.querySelectorAll<HTMLElement>('.ttg-cond[data-cond]')) {
      const rule = decodeCond(cond.getAttribute('data-cond') ?? '')
      if (!rule || rule.textStyle) continue
      const textStyle = nearbyTextStyle(cond)
      if (!textStyle) continue
      applyCondToElement(cond, { ...rule, textStyle })
      repairedStyleContext = true
    }
    for (const wrapper of body.querySelectorAll<HTMLElement>('[data-ttg-repeat="true"]')) {
      const first = wrapper.firstElementChild as HTMLElement | null
      const textStyle = first?.classList.contains('ttg-cond')
        ? nearbyTextStyle(first)
        : (capturedTextStyle(first) ?? nearbyTextStyle(wrapper))
      if (applyCapturedTextStyle(wrapper, textStyle)) repairedStyleContext = true
    }
    if (repairedStyleContext) persist()

    // beforeinput fires before mutation, so checkpoint at the start of a burst.
    body.addEventListener('beforeinput', () => {
      useWorkspace.getState().checkpoint('Escritura')
    })
    // Native undo cannot see chip/wrapper/margin mutations; use app history.
    doc.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase()
      if (!(e.ctrlKey || e.metaKey) || (k !== 'z' && k !== 'y')) return
      e.preventDefault()
      flushPersist()
      const st = useWorkspace.getState()
      const label = k === 'y' || (k === 'z' && e.shiftKey) ? st.redo() : st.undo()
      if (label) st.notify(`${k === 'y' || e.shiftKey ? 'Rehecho' : 'Deshecho'}: ${label}`)
    })

    // Handle deletion beside chips explicitly; Chromium otherwise may no-op.
    body.addEventListener('keydown', (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      const sel = doc.defaultView?.getSelection()
      if (!sel || !sel.isCollapsed || !sel.anchorNode) return
      const chip = chipBesideCaret(
        sel.anchorNode,
        sel.anchorOffset,
        e.key === 'Backspace' ? 'back' : 'fwd',
      )
      if (!chip) return
      e.preventDefault()
      checkpointFlushed(`Campo «${chip.dataset.field ?? ''}» eliminado`)
      removeChip(chip)
      persist()
    })

    body.addEventListener('input', () => {
      liveDecorateFields()
      inheritTypedBlockStyle()
      schedulePersist()
    })
    body.addEventListener('keyup', saveSelection)
    body.addEventListener('mouseup', saveSelection)
    body.addEventListener('focusout', persist)
    doc.addEventListener('selectionchange', refreshFmt)

    body.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null
      const cond = target?.closest?.('.ttg-cond') as HTMLElement | null
      if (cond) {
        const rule = decodeCond(cond.getAttribute('data-cond') ?? '')
        if (rule) {
          const textStyle = rule.textStyle ?? nearbyTextStyle(cond)
          setEditingCond({ el: cond, rule: textStyle ? { ...rule, textStyle } : rule })
        }
        return
      }
      const chip = target?.closest?.('.ttg-chip') as HTMLElement | null
      if (chip?.dataset.field) {
        const tag = chip.dataset.field
        const bound = useWorkspace.getState().ruleBindings[tag]
        if (bound) {
          const textStyle = bound.rule.textStyle ?? capturedTextStyle(chip)
          setBindingRule({
            tag,
            rule: textStyle ? { ...bound.rule, textStyle } : bound.rule,
            perRow: bound.perRow,
            existing: true,
          })
        }
        else setBindTag({ tag, el: chip })
      }
    })

    body.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types ?? []
      if (!types.includes(DRAG_MIME) && !types.includes(COND_MIME)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
      // Draw an explicit marker while the iframe is unfocused during a drag.
      const r = rangeFromPoint(doc, e.clientX, e.clientY)
      if (r) {
        const sel = doc.defaultView?.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(r)
        showDropMarker(doc, r)
      }
    })
    body.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) hideDropMarker(doc)
    })
    body.addEventListener('drop', (e) => {
      hideDropMarker(doc)
      const dt = e.dataTransfer
      if (!dt) return
      if (dt.types.includes(COND_MIME)) {
        e.preventDefault()
        const r = rangeFromPoint(doc, e.clientX, e.clientY)
        let block: HTMLElement | null = null
        let node: Node | null = r ? r.commonAncestorContainer : null
        while (node && node.parentNode !== doc.body) node = node.parentNode
        if (node && node.nodeType === 1) block = node as HTMLElement
        insertCondAfter(block)
        return
      }
      const column = dt.getData(DRAG_MIME) || dt.getData('text/plain')
      if (!column) return
      e.preventDefault()
      const range = rangeFromPoint(doc, e.clientX, e.clientY)
      if (range) {
        checkpointFlushed(`Campo «${column.trim()}»`)
        insertFieldAtRange(column, range)
      }
    })

    refreshBindings()
    // Do not persist in cleanup: docToken cleanup runs before the new HTML is written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docToken])

  useEffect(() => {
    refreshBindings()
  }, [data, mapping, ruleBindings, refreshBindings])

  const columns = data?.columns ?? []

  const showBlankHelp = !editorHtml.trim()

  return (
    <div className={`flex flex-col gap-1.5 ${className === 'hidden' ? 'hidden' : className}`}>
      <FormatToolbar
        fmt={fmt}
        textStyle={toolbarTextStyle}
        templateColors={templateColors}
        onCommand={execFormat}
        onFontSize={(sizePt) => execFormat('fontSizePt', String(sizePt))}
        onColor={(colorHex) => execFormat('foreColor', colorHex)}
      />
      {editorHtml.trim() ? (
        <MarginRuler
          iframeRef={iframeRef}
          docToken={docToken}
          onCommit={(l, r, w) => useWorkspace.getState().setPageMargins(l, r, w)}
        />
      ) : null}

      <div className="relative min-h-0 flex-1">
      <iframe
        ref={iframeRef}
        title="Editor de plantilla"
        className="h-full w-full rounded-lg border border-hairline bg-canvas-shell"
      />

      {showBlankHelp ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-canvas-soft/95 p-6">
          <div className="max-w-md">
            <h2 className="text-base font-semibold text-ink">Tres pasos para tus PDF</h2>
            <ol className="mt-3 space-y-2 text-sm text-ink-muted">
              <li>
                <strong className="text-ink">1.</strong> Pega arriba el enlace de tu documento
                de Google y pulsa <strong>Cargar</strong>.
              </li>
              <li>
                <strong className="text-ink">2.</strong> Carga tus datos (enlace de la hoja de
                Google).
              </li>
              <li>
                <strong className="text-ink">3.</strong> Arrastra las columnas de la izquierda
                al documento y pulsa <strong>Generar PDF</strong>.
              </li>
            </ol>
            <Button variant="secondary" className="mt-4" onClick={startBlankDocument}>
              O empieza con un documento en blanco (A4)
            </Button>
          </div>
        </div>
      ) : null}

      {bindTag ? (
        <BindFieldPopover
          tag={bindTag.tag}
          columns={columns}
          current={effectiveMapping([bindTag.tag], columns, mapping)[bindTag.tag]}
          implicit={!mapping[bindTag.tag]}
          format={tagFormats[bindTag.tag] ?? null}
          onAssign={(c) => {
            const had = Boolean(effectiveMapping([bindTag.tag], columns, mapping)[bindTag.tag])
            assign(bindTag.tag, c)
            if (had) setBindTag(null)
          }}
          onUnassign={() => {
            assign(bindTag.tag, null)
            setBindTag(null)
          }}
          onFormat={(f) => {
            setTagFormat(bindTag.tag, f)
            setBindTag(null)
          }}
          onRule={(perRow) => {
            const tag = bindTag.tag
            const textStyle = capturedTextStyle(bindTag.el)
            setBindTag(null)
            setBindingRule({ tag, rule: freshRule(textStyle), perRow, existing: false })
          }}
          onRemove={() => {
            checkpointFlushed(`Campo «${bindTag.tag}» eliminado`)
            removeChip(bindTag.el)
            persist()
            setBindTag(null)
          }}
          onClose={() => setBindTag(null)}
        />
      ) : null}

      {bindingRule ? (
        <CondEditor
          key={`bind-${bindingRule.tag}`}
          initial={bindingRule.rule}
          columns={columns}
          perRow={bindingRule.perRow}
          onSave={(rule, perRow) => {
            bindRule(bindingRule.tag, rule, perRow)
            setBindingRule(null)
          }}
          onDelete={() => {
            unbindRule(bindingRule.tag)
            setBindingRule(null)
          }}
          onClose={() => setBindingRule(null)}
          onRichSelection={handleRichSelection}
        />
      ) : null}

      {editingCond ? (
        <CondEditor
          key={editingCond.rule.id}
          initial={editingCond.rule}
          columns={columns}
          onSave={(rule) => {
            checkpointFlushed('Condición editada')
            applyCondToElement(editingCond.el, rule)
            persist()
            setEditingCond(null)
          }}
          onDelete={() => {
            checkpointFlushed('Condición eliminada')
            editingCond.el.remove()
            persist()
            setEditingCond(null)
          }}
          onClose={() => setEditingCond(null)}
          onRichSelection={handleRichSelection}
        />
      ) : null}
      </div>

      {askGroupMode ? (
        <ConfirmDialog
          title="Repetir necesita agrupar filas"
          body='Una sección repetible se repite por cada fila que entra en el mismo documento. En «un documento por fila» cada documento lleva una sola fila, así que no se repetiría. ¿Cambiar a «un documento por grupo»?'
          confirmLabel="Sí, agrupar filas"
          onConfirm={() => {
            const s = useWorkspace.getState()
            s.setGroup({
              mode: 'per_group',
              groupByColumn: s.group.groupByColumn ?? s.data?.columns[0] ?? null,
            })
            setAskGroupMode(false)
            s.notify('Modo cambiado a «un documento por grupo». Elige arriba la columna que agrupa.')
          }}
          onCancel={() => setAskGroupMode(false)}
        />
      ) : null}
    </div>
  )
})
