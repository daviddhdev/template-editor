import { useEffect } from 'react'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { meFn } from '../server/auth'
import { rehydrateStores } from '../state/workspaceStore'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const res = await meFn()
    if (!res.ok) throw new Error(res.error)
    if (!res.data) throw redirect({ to: '/login', search: { redirect: location.href } })
    return { user: res.data }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const { user } = Route.useRouteContext()

  useEffect(() => {
    void rehydrateStores(user)
  }, [user.id, user.email]) // eslint-disable-line react-hooks/exhaustive-deps

  return <Outlet />
}
