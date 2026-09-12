export function authGuard<R extends { ok: boolean; code?: string }>(res: R): R {
  if (!res.ok && res.code === 'AUTH') window.location.assign('/login')
  return res
}
