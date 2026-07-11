/** Helpers to turn pasted Google links into public export URLs. */

/** Extract the file id from a Google Docs/Sheets link. */
export function extractGoogleId(link: string): string | null {
  // .../d/<ID>/... covers both /document/d/ and /spreadsheets/d/
  const m = link.match(/\/d\/([a-zA-Z0-9_-]{20,})/)
  return m ? m[1] : null
}

/** Extract the folder id from a Drive folder link (or a bare id pasted). */
export function extractGoogleFolderId(link: string): string | null {
  const trimmed = link.trim()
  // .../drive/folders/<ID> and .../drive/u/0/folders/<ID>
  const m = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{20,})/)
  if (m) return m[1]
  return /^[a-zA-Z0-9_-]{20,}$/.test(trimmed) ? trimmed : null
}

/**
 * Extract the sheet tab gid from a Sheets link. `null` when the link carries
 * none (e.g. copied from the Share button) — that means "first tab", and the
 * distinction matters: an EXPLICIT gid pointing to a deleted tab must error
 * instead of silently reading the wrong data.
 */
export function extractSheetGid(link: string): string | null {
  const m = link.match(/[#&?]gid=(\d+)/)
  return m ? m[1] : null
}

/** The same Sheets link, pointing at the given tab. */
export function withSheetGid(link: string, gid: string): string {
  const cleaned = link
    .replace(/#gid=\d+/g, '')
    .replace(/([#&?])gid=\d+&?/g, '$1')
    .replace(/[#?&]$/, '')
  return `${cleaned}#gid=${gid}`
}

/** Public HTML export endpoint for a Google Doc. */
export function googleDocExportUrl(id: string): string {
  return `https://docs.google.com/document/d/${id}/export?format=html`
}

/** Public PDF export endpoint for a Google Doc (Google's exact pagination). */
export function googleDocPdfExportUrl(id: string): string {
  return `https://docs.google.com/document/d/${id}/export?format=pdf`
}

/** Public CSV export endpoint for a Google Sheet tab (gviz gives clean CSV).
 * `gid` null = the link named no tab: omit the parameter so Google serves the
 * FIRST tab (a hardcoded gid=0 pointed at a tab that may have been deleted,
 * while the authenticated route already meant "first tab"). */
export function googleSheetCsvUrl(id: string, gid: string | null): string {
  const tab = gid === null ? '' : `&gid=${gid}`
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${tab}`
}

/** True when the response body looks like a Google sign-in / access wall. */
export function looksLikeAccessWall(body: string): boolean {
  const head = body.slice(0, 4000).toLowerCase()
  return (
    head.includes('accounts.google.com') ||
    head.includes('sign in') ||
    head.includes('iniciar sesión') ||
    head.includes('request access') ||
    head.includes('needs permission') ||
    head.includes('you need access')
  )
}
