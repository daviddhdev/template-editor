import { useEffect } from 'react'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { meFn } from '../server/auth'
import { rehydrateStores } from '../state/workspaceStore'

/**
 * Pathless layout that gates every app screen behind the session. Runs on SSR
 * (the server fn executes in-process with the request's cookies) and on
 * client navigations alike. /login and /oauth/callback live outside it.
 */
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const res = await meFn()
    // DB down is an outage, not a login problem: error boundary, never a
    // redirect loop to /login.
    if (!res.ok) throw new Error(res.error)
    if (!res.data) throw redirect({ to: '/login', search: { redirect: location.href } })
    return { user: res.data }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const { user } = Route.useRouteContext()

  // The workspace draft is PER USER (DB row + per-user localStorage mirror):
  // hydrating with the session user restores that account's draft and cleans
  // any other account's mirror left on this browser (see draftStorage.ts).
  useEffect(() => {
    void rehydrateStores(user)
  }, [user.id, user.email]) // eslint-disable-line react-hooks/exhaustive-deps

  return <Outlet />
}
