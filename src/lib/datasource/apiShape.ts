/**
 * Pure helpers for reading an arbitrary JSON API response — no network, so the
 * probe endpoint (server/fetch.ts) and {@link ApiEndpointSource} share them and
 * they stay unit-testable. Real APIs don't return the neat `{columns, rows}`
 * the stub imagined: they nest the records under a key (`data.results`) and mix
 * scalars with objects/arrays. These turn that into the flat, all-string table
 * the rest of the app consumes (types.ts DataSourceData).
 */

/** Known keys a login response uses for the bearer token, shallowest wins. */
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

/** Navigate a dot-path (`data.results`); '' returns the value itself. */
export function getByPath(json: unknown, path: string): unknown {
  if (!path) return json
  let cur: unknown = json
  for (const seg of path.split('.')) {
    if (!isPlainObject(cur)) return undefined
    cur = cur[seg]
  }
  return cur
}

/**
 * Find the bearer token in a login response by looking for known key names,
 * breadth-first so a shallow `access_token` beats a nested one. Returns the
 * value and its dot-path (stored so a re-fetch reads the same place), or null.
 */
export function detectToken(login: unknown): { value: string; path: string } | null {
  const queue: { node: unknown; path: string }[] = [{ node: login, path: '' }]
  const seen = new Set<unknown>()
  while (queue.length > 0) {
    const { node, path } = queue.shift() as { node: unknown; path: string }
    if (!isPlainObject(node) || seen.has(node)) continue
    seen.add(node)
    // Known keys at THIS level first (shallowest match wins).
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

/**
 * List the arrays-of-objects reachable in a JSON response, as candidate record
 * lists for the user to pick from (path + item count). Breadth-first, so the
 * outermost list comes first; a root array is reported at path ''.
 */
export function findRecordArrays(json: unknown): { path: string; count: number }[] {
  const out: { path: string; count: number }[] = []
  const queue: { node: unknown; path: string }[] = [{ node: json, path: '' }]
  const seen = new Set<unknown>()
  while (queue.length > 0) {
    const { node, path } = queue.shift() as { node: unknown; path: string }
    if (node == null || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) {
      // A list of records = a non-empty array whose items are objects. Do not
      // descend into the records themselves hunting for more lists.
      if (node.length > 0 && isPlainObject(node[0])) out.push({ path, count: node.length })
      continue
    }
    for (const [k, v] of Object.entries(node)) {
      queue.push({ node: v, path: path ? `${path}.${k}` : k })
    }
  }
  return out
}

/** A scalar cell value coerced to string. */
function cellToString(v: string | number | boolean): string {
  return typeof v === 'string' ? v : String(v)
}

/**
 * Flatten one record to leaf columns: nested objects become dot-paths
 * (`customer.name`), scalars become one string cell. Arrays are NOT offered as
 * columns (a nested list has no place in a flat mail-merge row), and null /
 * undefined leaves are skipped — so a field that is `null` in one record and an
 * object in another does not spawn a stray empty column beside its dot-paths.
 * Non-object records yield {} (dropped later for want of columns).
 */
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

/** Union of flattened leaf keys across records, in first-seen order. */
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
