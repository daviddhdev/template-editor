import { createFileRoute } from '@tanstack/react-router'
import { Workspace } from '../components/Workspace'

export const Route = createFileRoute('/_authed/editor')({ component: Editor })

function Editor() {
  return (
    <main className="min-h-screen bg-canvas-soft">
      <Workspace />
    </main>
  )
}
