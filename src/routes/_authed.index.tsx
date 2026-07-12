import { createFileRoute } from '@tanstack/react-router'
import { HomeScreen } from '../components/Home'

export const Route = createFileRoute('/_authed/')({ component: Home })

function Home() {
  return (
    <main className="min-h-screen bg-canvas-soft">
      <HomeScreen />
    </main>
  )
}
