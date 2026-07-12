/**
 * users table access (SERVER ONLY — import dynamically). One row per person;
 * it also holds their Google connection (refresh token + granted scopes),
 * which replaced the old global .google-oauth.json file.
 */

import { getSql } from './db'

export interface GoogleTokenRow {
  refreshToken: string | null
  accessToken: string | null
  /** Epoch ms after which accessToken must be refreshed. */
  expiresAt: number | null
  /** Space-separated scopes Google actually granted. */
  scopes: string
}

export interface LoginTokens {
  refreshToken: string
  accessToken: string
  expiresAt: number
  scopes: string
}

/** Create-or-refresh the user on login. Every login carries a fresh consent
 * (prompt=consent), so the stored refresh token is always replaced. */
export async function upsertUserOnLogin(
  email: string,
  tokens: LoginTokens,
): Promise<{ id: string }> {
  const sql = await getSql()
  const rows = await sql`
    INSERT INTO users (email, google_refresh_token, google_access_token,
      google_access_expires_at, google_scopes)
    VALUES (${email}, ${tokens.refreshToken}, ${tokens.accessToken},
      ${new Date(tokens.expiresAt)}, ${tokens.scopes})
    ON CONFLICT (email) DO UPDATE SET
      google_refresh_token = EXCLUDED.google_refresh_token,
      google_access_token = EXCLUDED.google_access_token,
      google_access_expires_at = EXCLUDED.google_access_expires_at,
      google_scopes = EXCLUDED.google_scopes,
      last_login_at = now()
    RETURNING id`
  return { id: rows[0].id as string }
}

export async function readGoogleTokens(userId: string): Promise<GoogleTokenRow | null> {
  const sql = await getSql()
  const rows = await sql`
    SELECT google_refresh_token, google_access_token, google_access_expires_at, google_scopes
    FROM users WHERE id = ${userId}`
  if (rows.length === 0) return null
  return {
    refreshToken: (rows[0].google_refresh_token as string | null) ?? null,
    accessToken: (rows[0].google_access_token as string | null) ?? null,
    expiresAt: rows[0].google_access_expires_at
      ? (rows[0].google_access_expires_at as Date).getTime()
      : null,
    scopes: (rows[0].google_scopes as string) ?? '',
  }
}

/** Persist a refreshed access token (the refresh token does not change). */
export async function saveAccessToken(
  userId: string,
  accessToken: string,
  expiresAt: number,
): Promise<void> {
  const sql = await getSql()
  await sql`UPDATE users SET google_access_token = ${accessToken},
    google_access_expires_at = ${new Date(expiresAt)} WHERE id = ${userId}`
}

/** The refresh token turned out dead (revoked/expired): forget the connection
 * so the UI offers "Reconectar" instead of retrying a doomed refresh. */
export async function clearGoogleTokens(userId: string): Promise<void> {
  const sql = await getSql()
  await sql`UPDATE users SET google_refresh_token = NULL, google_access_token = NULL,
    google_access_expires_at = NULL, google_scopes = '' WHERE id = ${userId}`
}
