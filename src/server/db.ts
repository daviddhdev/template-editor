// Server-only Postgres access; numbered migrations run lazily on first use.

import postgres from 'postgres'
import { readDotEnv } from './env'

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

// Append-only migrations; never edit an applied entry.
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
  // Imported source snapshot for the native generation route.
  `ALTER TABLE recipes ADD COLUMN source_file jsonb`,
  `ALTER TABLE recipes ADD COLUMN rule_bindings jsonb NOT NULL DEFAULT '{}'`,
  `ALTER TABLE recipes ADD COLUMN output_folder_url text NOT NULL DEFAULT ''`,
  // Audit rows retain literal recipe ids and interrupted running batches.
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
  // Google OAuth identity and per-user refresh token.
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
  `CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  )`,
  `DELETE FROM recipes`,
  `ALTER TABLE recipes ADD COLUMN owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`,
  `CREATE INDEX recipes_owner_idx ON recipes (owner_id, updated_at DESC)`,
  `DELETE FROM generation_runs`,
  `ALTER TABLE generation_runs ADD COLUMN owner_id uuid NOT NULL`,
  `CREATE INDEX generation_runs_owner_idx ON generation_runs (owner_id, started_at DESC)`,
  `CREATE TABLE workspace_drafts (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload text NOT NULL,
    saved_at_ms bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE recipes ADD COLUMN tag_formats jsonb NOT NULL DEFAULT '{}'`,
  `ALTER TABLE recipes ADD COLUMN api_config jsonb`,
  `CREATE TABLE manual_form_drafts (
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    payload jsonb NOT NULL DEFAULT '{}',
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, recipe_id)
  )`,
  `ALTER TABLE recipes ADD COLUMN current_version int NOT NULL DEFAULT 1 CHECK (current_version > 0);
   CREATE TABLE recipe_versions (
     recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
     version int NOT NULL CHECK (version > 0),
     created_at timestamptz NOT NULL DEFAULT now(),
     restored_from_version int,
     template_url text NOT NULL DEFAULT '',
     editor_html text NOT NULL,
     editor_css text NOT NULL DEFAULT '',
     editor_title text NOT NULL DEFAULT '',
     editor_body_class text NOT NULL DEFAULT '',
     data_kind text NOT NULL DEFAULT 'google_sheet',
     data_url text NOT NULL DEFAULT '',
     api_config jsonb,
     mapping jsonb NOT NULL DEFAULT '{}',
     group_config jsonb NOT NULL DEFAULT '{}',
     rule_bindings jsonb NOT NULL DEFAULT '{}',
     tag_formats jsonb NOT NULL DEFAULT '{}',
     source_file jsonb,
     output_folder_url text NOT NULL DEFAULT '',
     thumbnail bytea,
     PRIMARY KEY (recipe_id, version)
   );
   INSERT INTO recipe_versions (
     recipe_id, version, created_at, template_url, editor_html, editor_css,
     editor_title, editor_body_class, data_kind, data_url, api_config,
     mapping, group_config, rule_bindings, tag_formats, source_file,
     output_folder_url, thumbnail
   )
   SELECT id, 1, updated_at, template_url, editor_html, editor_css,
     editor_title, editor_body_class, data_kind, data_url, api_config,
     mapping, group_config, rule_bindings, tag_formats, source_file,
     output_folder_url, thumbnail
   FROM recipes;
   CREATE INDEX recipe_versions_created_idx ON recipe_versions (recipe_id, version DESC);`,
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

export async function getSql(): Promise<postgres.Sql> {
  if (!client) {
    client = postgres(databaseUrl(), { max: 5, connect_timeout: 4 })
  }
  if (!schemaReady) {
    try {
      await migrate(client)
      schemaReady = true
    } catch (err) {
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
