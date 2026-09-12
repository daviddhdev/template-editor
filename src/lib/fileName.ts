export function safeName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim()
  return (cleaned || 'documento').slice(0, 80)
}

export function batchFolderName(label: string, date: Date): string {
  const base = label.trim() ? safeName(label) : 'Documentos'
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}.${pad(date.getMinutes())}`
  return `${base} ${stamp}`
}
