import { parse } from 'node-html-parser'
import type { GenerationPlan, TemplateBlock } from '../../types'
import { escapeHtml } from '../html'
import { decodeCond } from '../cond'
import { resolveConditional } from './conditionals'
import type { RowGroup } from './grouping'
import { substituteTags, type SubstituteOptions } from './substitute'

type MissingMode = SubstituteOptions['onMissing']

/**
 * Replace every inline conditional (`[data-cond]` element) nested inside an
 * HTML fragment with its resolved text for the given row. This is what makes
 * a conditional dropped INSIDE a repeatable section evaluate once per row.
 */
function resolveInlineConds(
  html: string,
  row: Record<string, string>,
  sub: Omit<SubstituteOptions, 'row'>,
): string {
  if (!html.includes('data-cond')) return html
  const root = parse(`<div id="__r">${html}</div>`, { comment: false })
  const wrapper = root.querySelector('#__r')!
  for (const el of wrapper.querySelectorAll('[data-cond]')) {
    const rule = decodeCond(el.getAttribute('data-cond') ?? '')
    const resolved = rule ? resolveConditional(rule, row, sub) : ''
    el.insertAdjacentHTML('afterend', resolved)
    el.remove()
  }
  return wrapper.innerHTML
}

/** Render one block for one row. An inline-conditional block resolves to the
 * rule's chosen text; any other block substitutes its fields (and any
 * conditionals nested inside it, e.g. within a repeat wrapper). */
function renderBlockForRow(
  block: TemplateBlock,
  row: Record<string, string>,
  plan: GenerationPlan,
  onMissing: MissingMode,
  groupRows: Record<string, string>[],
): string {
  const sub = {
    mapping: plan.mapping,
    onMissing,
    ruleBindings: plan.ruleBindings,
    groupRows,
    tagFormats: plan.tagFormats,
  }
  if (block.cond) return resolveConditional(block.cond, row, sub)
  return substituteTags(resolveInlineConds(block.html, row, sub), { ...sub, row })
}

/**
 * Build the inner body HTML for one output document (one {@link RowGroup}).
 *
 * - Non-repeatable blocks use the group's first row (group-level fields such as
 *   NIF or company name are constant across the group).
 * - Repeatable blocks (only in per_group mode) render once per row of the
 *   group; conditionals inside them are evaluated per row too.
 */
export function resolveGroupBody(
  plan: GenerationPlan,
  group: RowGroup,
  onMissing: MissingMode,
): string {
  const rep = group.rows[0] ?? {}
  const grouped = plan.group.mode === 'per_group'

  const parts: string[] = []
  for (const block of plan.template.blocks) {
    if (grouped && block.repeat && group.rows.length > 0) {
      const repeated = group.rows
        .map((row) => renderBlockForRow(block, row, plan, onMissing, group.rows))
        .join('\n')
      parts.push(`<div class="ttg-repeat">${repeated}</div>`)
    } else {
      parts.push(renderBlockForRow(block, rep, plan, onMissing, group.rows))
    }
  }
  return parts.join('\n')
}

/**
 * Minimal styles layered on top of the ORIGINAL document CSS. We deliberately
 * do NOT set font, colour, line-height or margins here — those must come from
 * the source document so the output is identical to it.
 *
 * Page margins are intentionally NOT set here: the body's own padding (the
 * doc's margins) works for the on-screen preview, but for the PDF that padding
 * would only apply to the first/last page. The PDF step instead reads that
 * padding and turns it into real per-page margins (see `server/pdf.ts`), so
 * every page — not just the first — gets proper top/bottom margins and the page
 * breaks fall where the original document's do.
 */
function frameStyles(): string {
  return `
    /* SCREEN ONLY (the preview iframe): show the document as a centred page
       on a grey canvas, like the editor. Print — the actual PDF — is
       untouched: server/pdf.ts overrides margins itself, and Google's
       importer ignores screen media rules. */
    @media screen {
      html { background: #e5e7eb; }
      body {
        margin: 16px auto !important;
        box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 12px 30px rgba(0,0,0,.12);
      }
    }
    .ttg-repeat > * { break-inside: avoid; }
    /* Blocks marked as "starts a new page in the original" (data-page-break),
       either auto-detected from the source doc's own PDF pagination or set
       manually in the editor. Print-only: the on-screen preview is a
       continuous flow and must not show artefacts. */
    @media print {
      [data-page-break="true"] { break-before: page; }
    }
    /* Only visible in previews; the final PDF should have no unmapped fields. */
    .ttg-missing {
      background: #fde68a;
      color: #92400e;
      padding: 0 3px;
      border-radius: 3px;
      font-style: normal;
    }
  `
}

/**
 * Wrap resolved body HTML into a complete, standalone HTML document, preserving
 * the source document's CSS and page-geometry class untouched.
 * The SAME string is used for the on-screen preview (iframe) and for the PDF
 * (Playwright), which is what keeps the preview faithful to the final file.
 */
export function buildDocumentHtml(plan: GenerationPlan, bodyHtml: string): string {
  // Escaped: a quote inside the class attribute would break out of it.
  const bodyClass = plan.template.bodyClass
    ? ` class="${escapeHtml(plan.template.bodyClass)}"`
    : ''
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>${plan.template.css}</style>
<style>${frameStyles()}</style>
</head>
<body${bodyClass}>
${bodyHtml}
</body>
</html>`
}

/** Convenience: resolve a whole group straight to a standalone HTML document. */
export function resolveGroupDocument(
  plan: GenerationPlan,
  group: RowGroup,
  onMissing: MissingMode,
): string {
  return buildDocumentHtml(plan, resolveGroupBody(plan, group, onMissing))
}
