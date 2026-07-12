import { useEffect } from 'react'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { meFn } from '../server/auth'
import { rehydrateStores, useWorkspace } from '../state/workspaceStore'

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

/** The account the persisted workspace draft belongs to (browser-local). */
const LAST_USER_KEY = 'ttg-last-user'

function AuthedLayout() {
  const { user } = Route.useRouteContext()

  // The workspace draft lives in localStorage (per browser, not per user):
  // when a DIFFERENT account logs in on this browser, reset it so nobody
  // continues someone else's draft. Same account re-login keeps the draft.
  useEffect(() => {
    void (async () => {
      await rehydrateStores()
      const last = localStorage.getItem(LAST_USER_KEY)
      if (last !== null && last !== user.email) useWorkspace.getState().reset()
      localStorage.setItem(LAST_USER_KEY, user.email)
    })()
  }, [user.email])

  return <Outlet />
}
