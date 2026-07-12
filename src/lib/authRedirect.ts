/**
 * Client-side reaction to the server's AUTH sentinel (session missing or
 * expired): bounce to the login screen. Applied at the screen-level data
 * loads; mid-action expiry elsewhere just shows the Result error, and the
 * next navigation lands here via the route guard.
 */
export function authGuard<R extends { ok: boolean; code?: string }>(res: R): R {
  if (!res.ok && res.code === 'AUTH') window.location.assign('/login')
  return res
}
