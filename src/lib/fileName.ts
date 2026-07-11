/** Make a file-system-safe base name (shared by every generation route AND by
 * the grouping dedupe, which must compare keys in their post-normalisation
 * form — two distinct keys can collapse to the same file name). */
export function safeName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim()
  return (cleaned || 'documento').slice(0, 80)
}

/** Drive folder name for one generation batch: template label + local
 * timestamp. Dots instead of ':' in the time — safeName rejects ':'. */
export function batchFolderName(label: string, date: Date): string {
  const base = label.trim() ? safeName(label) : 'Documentos'
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}.${pad(date.getMinutes())}`
  return `${base} ${stamp}`
}
