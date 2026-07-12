/**
 * Postgres access (SERVER ONLY — import dynamically from server-function
 * handlers, same pattern as googleClient.ts). One shared client; the schema
 * is applied lazily on first use via a tiny numbered-migrations table, so
 * "docker compose up -d" is the only setup step.
 */

import postgres from 'postgres'
import { readDotEnv } from './env'

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
  // Vite does not surface custom .env vars in process.env on the server.
  return (
    process.env.DATABASE_URL ?? readDotEnv().DATABASE_URL ?? 'postgres://ttg:ttg@localhost:5433/ttg'
  )
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
  // Imported Drive file + as-imported fingerprints (lib/nativeMerge.ts):
  // lets an unedited saved template keep the native generation route.
  `ALTER TABLE recipes ADD COLUMN source_file jsonb`,
  // Tag -> rule bindings (anchored conditionals / repeatable sections).
  `ALTER TABLE recipes ADD COLUMN rule_bindings jsonb NOT NULL DEFAULT '{}'`,
  // Drive folder URL where generated documents are uploaded (per template).
  `ALTER TABLE recipes ADD COLUMN output_folder_url text NOT NULL DEFAULT ''`,
  // Audit log: one row per generation batch. recipe_id has NO foreign key on
  // purpose — the audit trail must survive template deletion and keep the
  // literal id; template_name is a point-in-time snapshot for display.
  // A row left in status 'running' without finished_at is evidence of an
  // interrupted batch (browser closed mid-run). Append-only: never DELETE.
  `CREATE TABLE generation_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done')),
    recipe_id uuid,
    template_name text NOT NULL,
    route text NOT NULL CHECK (route IN ('native','google_html','local')),
    data_kind text NOT NULL,
    data_url text NOT NULL DEFAULT '',
    row_count int NOT NULL DEFAULT 0,
    formats text[] NOT NULL DEFAULT '{pdf}',
    actor_email text,
    drive_folder_url text,
    doc_count int NOT NULL DEFAULT 0,
    ok_count int NOT NULL DEFAULT 0,
    error_count int NOT NULL DEFAULT 0,
    docs jsonb NOT NULL DEFAULT '[]'
  )`,
  `CREATE INDEX generation_runs_started_at_idx ON generation_runs (started_at DESC)`,
  // Multiusuario: el login es el OAuth de Google (scope drive + openid email).
  // El refresh token vive POR USUARIO aquí — sustituye al .google-oauth.json
  // global. En claro por ahora (cifrado en reposo = pendiente en TODO.md).
  `CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    google_refresh_token text,
    google_access_token text,
    google_access_expires_at timestamptz,
    google_scopes text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz NOT NULL DEFAULT now()
  )`,
  // Sesiones opacas: la cookie lleva el token; aquí solo su hash SHA-256.
  // Las filas caducadas se purgan de forma oportunista en cada login.
  `CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  )`,
  // Plantillas por usuario. Las filas anteriores a la autenticación se borran
  // (decisión confirmada: no existen plantillas compartidas), lo que permite
  // owner_id NOT NULL desde el primer día.
  `DELETE FROM recipes`,
  `ALTER TABLE recipes ADD COLUMN owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`,
  `CREATE INDEX recipes_owner_idx ON recipes (owner_id, updated_at DESC)`,
  // Historial por usuario. owner_id SIN foreign key a propósito (misma
  // convención que recipe_id arriba): la auditoría sobrevive al borrado.
  `DELETE FROM generation_runs`,
  `ALTER TABLE generation_runs ADD COLUMN owner_id uuid NOT NULL`,
  `CREATE INDEX generation_runs_owner_idx ON generation_runs (owner_id, started_at DESC)`,
  // Borrador de trabajo por usuario (autosave del workspace) — sustituye al
  // localStorage 'ttg-workspace' compartido por navegador. Una fila por
  // usuario; payload = el MISMO JSON que persiste zustand. saved_at_ms es el
  // reloj del cliente que guardó: se compara con el espejo local del
  // navegador al hidratar (gana el más nuevo, ver state/draftStorage.ts).
  `CREATE TABLE workspace_drafts (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload text NOT NULL,
    saved_at_ms bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  // Tag -> display format (fecha larga, importe en letra…), lib/engine/format.ts.
  `ALTER TABLE recipes ADD COLUMN tag_formats jsonb NOT NULL DEFAULT '{}'`,
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
