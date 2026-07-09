import { createFileRoute } from '@tanstack/react-router'
import { Workspace } from '../components/Workspace'

export const Route = createFileRoute('/editor')({ component: Editor })

function Editor() {
  return (
    <main className="min-h-screen bg-slate-50">
      <Workspace />
    </main>
  )
}
