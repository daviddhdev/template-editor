
import type { ConditionalRule } from "../types";
import { condSummaryHtml, encodeCond } from "./cond";
import { escapeHtml } from "./html";
import { tagRe } from "./tagRegex";

// Storage form keeps literal tags; display form wraps them in non-editable chips.
const FIELD_RE = tagRe();

export function makeFieldChip(
  name: string,
  doc: Document = document,
): HTMLSpanElement {
  const span = doc.createElement("span");
  span.className = "ttg-chip";
  span.setAttribute("contenteditable", "false");
  span.dataset.field = name;
  span.textContent = `{{${name}}}`;
  return span;
}

/** Display-only caret anchor; U+200B must survive the storage round-trip. */
export const CARET_ANCHOR = "​";
const ZWSP_ONLY_RE = /^​*$/;
const ZWSP_RE = /​/g;

export function isAnchorText(node: Node): boolean {
  return (
    node.nodeType === Node.TEXT_NODE && ZWSP_ONLY_RE.test((node as Text).data)
  );
}

function decoratedFragment(
  text: string,
  doc: Document = document,
): DocumentFragment {
  const frag = doc.createDocumentFragment();
  let last = 0;
  let m: RegExpExecArray | null;
  FIELD_RE.lastIndex = 0;
  while ((m = FIELD_RE.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(makeFieldChip(m[1].trim(), doc));
    frag.append(doc.createTextNode(CARET_ANCHOR));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

export function decorateTextNodeLive(t: Text, doc: Document): Node | null {
  FIELD_RE.lastIndex = 0;
  if (!FIELD_RE.test(t.data)) return null;
  const frag = decoratedFragment(t.data, doc);
  const last = frag.lastChild;
  t.replaceWith(frag);
  return last;
}

export function decorateFields(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    if (t.parentElement?.classList.contains("ttg-chip")) continue;
    if (t.parentElement?.closest(".ttg-cond")) continue;
    FIELD_RE.lastIndex = 0; // global regex: a stale lastIndex would skip fields
    if (FIELD_RE.test(t.data)) targets.push(t);
  }
  for (const t of targets) t.replaceWith(decoratedFragment(t.data));
  return root.innerHTML;
}

export function undecorateFields(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  root.querySelectorAll(".ttg-chip").forEach((el) => {
    // Chromium may style the chip itself or wrap it; preserve either form.
    const name =
      (el as HTMLElement).dataset.field ??
      el.textContent?.replace(/[{}]/g, "").trim() ??
      "";
    const literal = `{{${name}}}`;
    const textIntact = el.textContent?.replace(ZWSP_RE, "") === literal;
    const ownStyle = el.getAttribute("style")?.trim() ?? "";
    const inner: (Node | string)[] =
      el.querySelector("*") && textIntact
        ? Array.from(el.childNodes)
        : [document.createTextNode(literal)];
    if (ownStyle && textIntact) {
      const span = document.createElement("span");
      span.setAttribute("style", ownStyle);
      span.append(...inner);
      el.replaceWith(span);
    } else {
      el.replaceWith(...inner);
    }
  });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if ((n as Text).data.includes(CARET_ANCHOR)) texts.push(n as Text);
  }
  for (const t of texts) {
    const cleaned = t.data.replace(ZWSP_RE, "");
    const parent = t.parentElement;
    if (cleaned) t.data = cleaned;
    else t.remove();
    let p = parent;
    while (
      p &&
      p !== root &&
      p.childNodes.length === 0 &&
      p.tagName === "SPAN"
    ) {
      const up = p.parentElement;
      p.remove();
      p = up;
    }
  }
  return root.innerHTML;
}

const EDITOR_BASE_CSS = `body{font-family:Arial,Helvetica,sans-serif;color:#111;}`;

const EDITOR_CHROME_CSS = `
  html{background:#ECE8DE;}
  body{margin:24px auto !important;outline:none;box-shadow:0 2px 8px rgba(15,15,15,.06),0 9px 24px rgba(15,15,15,.1);}
  /* No font-weight of its own: the chip must INHERIT bold/italic applied to
     the text around it, or formatting a selection with a field would show
     everything bold except the field. */
  .ttg-chip{display:inline;background:rgba(15,92,94,.1);color:inherit;border-radius:4px;padding:1px 6px;margin:0 1px;white-space:nowrap;cursor:pointer;outline:1px solid rgba(15,92,94,.35);}
  /* Field whose name matches no data column yet: needs a click to bind. */
  .ttg-chip.ttg-unbound{background:rgba(184,92,56,.1);outline:1px dashed #B85C38;}
  /* Field bound to a rule (anchored conditional / repeatable section). */
  .ttg-chip.ttg-rulebound{background:rgba(15,92,94,.12);outline:1px solid rgba(15,92,94,.5);}
  /* Section repeated once per row of the group. The label sits IN FLOW (same
     pattern as .ttg-cond::before): an absolutely-positioned pill overflowed
     narrow sections and overlapped the first content line.
     toggleRepeat always marks a WRAPPER <div> (full width, no inherited
     paragraph geometry), but documents saved before that marked the block
     element itself — the ::before resets below (text-indent, text-align,
     margin-left) keep the label in place inside those too, where the
     paragraph's own negative text-indent pushed it out of the box. */
  [data-ttg-repeat="true"]{border-left:3px solid #287777;padding:6px 8px 8px !important;background:rgba(15,92,94,.06);border-radius:0 6px 6px 0;}
  [data-ttg-repeat="true"]::before{content:'se repite por cada fila';display:block;margin:0 0 4px;color:#1D6F6C;font:600 9px Manrope,Arial,sans-serif;letter-spacing:.4px;text-transform:uppercase;text-indent:0;text-align:left;margin-left:0;}
  /* Inline conditional block: shows a readable summary, click to edit. */
  .ttg-cond{display:block;margin:8px 0;padding:8px 12px;border:1px solid rgba(141,63,36,.45);border-radius:8px;background:rgba(184,92,56,.05);color:#793400;font:500 12px/1.6 Manrope,Arial,sans-serif;cursor:pointer;}
  .ttg-cond::before{content:'texto condicional — clic para editar';display:block;margin-bottom:2px;color:#8D3F24;font:600 9px Manrope,Arial,sans-serif;letter-spacing:.4px;text-transform:uppercase;}
  .ttg-cond .ttg-cond-line{display:block;}
  /* Insertion caret shown while dragging a column over the document. */
  .ttg-drop-caret{position:absolute;width:2px;border-radius:1px;background:#0F5C5E;pointer-events:none;display:none;z-index:9999;}
`;

export function buildEditorDocument(
  css: string,
  bodyClass: string,
  decoratedBody: string,
): string {
  const cls = bodyClass ? ` class="${escapeHtml(bodyClass)}"` : "";
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${EDITOR_BASE_CSS}</style>
<style>${css}</style>
<style>${EDITOR_CHROME_CSS}</style>
</head><body${cls} contenteditable="true" spellcheck="false">${decoratedBody}</body></html>`;
}

export function fieldsIn(html: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  FIELD_RE.lastIndex = 0;
  while ((m = FIELD_RE.exec(html))) out.push(m[1].trim());
  return out;
}

export function applyCondToElement(
  el: HTMLElement,
  rule: ConditionalRule,
): void {
  el.className = "ttg-cond";
  el.setAttribute("contenteditable", "false");
  el.setAttribute("data-cond", encodeCond(rule));
  el.innerHTML = condSummaryHtml(rule);
}

export function makeCondElement(
  rule: ConditionalRule,
  doc: Document = document,
): HTMLElement {
  const el = doc.createElement("div");
  applyCondToElement(el, rule);
  return el;
}
