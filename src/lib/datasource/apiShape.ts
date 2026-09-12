
const TOKEN_KEYS = [
  'access_token',
  'accessToken',
  'token',
  'auth_token',
  'authToken',
  'id_token',
  'idToken',
  'jwt',
] as const

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

export function getByPath(json: unknown, path: string): unknown {
  if (!path) return json
  let cur: unknown = json
  for (const seg of path.split('.')) {
    if (!isPlainObject(cur)) return undefined
    cur = cur[seg]
  }
  return cur
}

export function detectToken(login: unknown): { value: string; path: string } | null {
  const queue: { node: unknown; path: string }[] = [{ node: login, path: '' }]
  const seen = new Set<unknown>()
  while (queue.length > 0) {
    const { node, path } = queue.shift() as { node: unknown; path: string }
    if (!isPlainObject(node) || seen.has(node)) continue
    seen.add(node)
    for (const key of TOKEN_KEYS) {
      const v = node[key]
      if (typeof v === 'string' && v.length > 0) {
        return { value: v, path: path ? `${path}.${key}` : key }
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (isPlainObject(v)) queue.push({ node: v, path: path ? `${path}.${k}` : k })
    }
  }
  return null
}

export function findRecordArrays(json: unknown): { path: string; count: number }[] {
  const out: { path: string; count: number }[] = []
  const queue: { node: unknown; path: string }[] = [{ node: json, path: '' }]
  const seen = new Set<unknown>()
  while (queue.length > 0) {
    const { node, path } = queue.shift() as { node: unknown; path: string }
    if (node == null || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) {
      if (node.length > 0 && isPlainObject(node[0])) out.push({ path, count: node.length })
      continue
    }
    for (const [k, v] of Object.entries(node)) {
      queue.push({ node: v, path: path ? `${path}.${k}` : k })
    }
  }
  return out
}

function cellToString(v: string | number | boolean): string {
  return typeof v === 'string' ? v : String(v)
}

export function flattenRecord(record: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (node: unknown, prefix: string): void => {
    if (Array.isArray(node)) return
    if (isPlainObject(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}.${k}` : k)
      return
    }
    if (node == null) return
    if (prefix) out[prefix] = cellToString(node as string | number | boolean)
  }
  if (isPlainObject(record)) walk(record, '')
  return out
}

export function extractColumns(records: unknown[]): string[] {
  const seen = new Set<string>()
  const cols: string[] = []
  for (const r of records) {
    for (const key of Object.keys(flattenRecord(r))) {
      if (!seen.has(key)) {
        seen.add(key)
        cols.push(key)
      }
    }
  }
  return cols
}
