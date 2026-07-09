/**
 * Postgres access (SERVER ONLY — import dynamically from server-function
 * handlers, same pattern as googleClient.ts). One shared client; the schema
 * is applied lazily on first use via a tiny numbered-migrations table, so
 * "docker compose up -d" is the only setup step.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'

/** Error with a user-facing message + actionable hint. */
export class DbError extends Error {
  hint?: string
  constructor(message: string, hint?: string) {
    super(message)
    this.hint = hint
  }
}

export const DB_DOWN = new DbError(
  'No se pudo conectar con la base de datos.',
  'Arráncala con «docker compose up -d» en la carpeta del proyecto y vuelve a intentarlo.',
)

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  // Vite does not surface custom .env vars in process.env on the server.
  const file = path.resolve(process.cwd(), '.env')
  if (existsSync(file)) {
    const m = readFileSync(file, 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/m)
    if (m) return m[1].replace(/^["']|["']$/g, '')
  }
  return 'postgres://ttg:ttg@localhost:5433/ttg'
}

/** Numbered migrations; append only — never edit an applied entry. */
const MIGRATIONS: string[] = [
  `CREATE TABLE recipes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    template_url text NOT NULL DEFAULT '',
    editor_html text NOT NULL,
    editor_css text NOT NULL DEFAULT '',
    editor_title text NOT NULL DEFAULT '',
    editor_body_class text NOT NULL DEFAULT '',
    data_kind text NOT NULL DEFAULT 'google_sheet',
    data_url text NOT NULL DEFAULT '',
    mapping jsonb NOT NULL DEFAULT '{}',
    group_config jsonb NOT NULL DEFAULT '{}',
    thumbnail bytea,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
]

let client: postgres.Sql | null = null
let schemaReady = false

async function migrate(sql: postgres.Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version int PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`
  const applied = new Set(
    (await sql`SELECT version FROM schema_migrations`).map((r) => r.version as number),
  )
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const version = i + 1
    if (applied.has(version)) continue
    await sql.begin(async (tx) => {
      await tx.unsafe(MIGRATIONS[i])
      await tx`INSERT INTO schema_migrations (version) VALUES (${version})`
    })
  }
}

/** The shared client, with the schema guaranteed. Throws DbError when down. */
export async function getSql(): Promise<postgres.Sql> {
  if (!client) {
    client = postgres(databaseUrl(), { max: 5, connect_timeout: 4 })
  }
  if (!schemaReady) {
    try {
      await migrate(client)
      schemaReady = true
    } catch (err) {
      // Connection-level failures surface as an actionable message; anything
      // else (bad SQL) should crash loudly during development.
      const code = (err as { code?: string }).code ?? ''
      if (
        code.startsWith('ECONN') ||
        code === 'ENOTFOUND' ||
        code === 'ETIMEDOUT' ||
        code === 'CONNECT_TIMEOUT' ||
        code === 'ECONNREFUSED'
      ) {
        throw DB_DOWN
      }
      throw err
    }
  }
  return client
}
