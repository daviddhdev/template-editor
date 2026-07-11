/**
 * Minimal KEY=VALUE parser for the project's .env (Vite does not surface
 * custom vars into process.env on the server). Quotes and comments tolerated.
 * Shared by the Google credentials and the database URL lookups.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export function readDotEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), '.env')
  if (!existsSync(file)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || m[1].startsWith('#')) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
