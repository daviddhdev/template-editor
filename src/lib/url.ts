
export function extractGoogleId(link: string): string | null {
  const m = link.match(/\/d\/([a-zA-Z0-9_-]{20,})/)
  return m ? m[1] : null
}

export function extractGoogleFolderId(link: string): string | null {
  const trimmed = link.trim()
  const m = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{20,})/)
  if (m) return m[1]
  return /^[a-zA-Z0-9_-]{20,}$/.test(trimmed) ? trimmed : null
}

/** `null` means first tab; an explicit deleted gid must still error. */
export function extractSheetGid(link: string): string | null {
  const m = link.match(/[#&?]gid=(\d+)/)
  return m ? m[1] : null
}

export function withSheetGid(link: string, gid: string): string {
  const cleaned = link
    .replace(/#gid=\d+/g, '')
    .replace(/([#&?])gid=\d+&?/g, '$1')
    .replace(/[#?&]$/, '')
  return `${cleaned}#gid=${gid}`
}

export function googleDocExportUrl(id: string): string {
  return `https://docs.google.com/document/d/${id}/export?format=html`
}

export function googleDocPdfExportUrl(id: string): string {
  return `https://docs.google.com/document/d/${id}/export?format=pdf`
}

/** Public CSV export; omit `gid` when the link names no tab. */
export function googleSheetCsvUrl(id: string, gid: string | null): string {
  const tab = gid === null ? '' : `&gid=${gid}`
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${tab}`
}

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
