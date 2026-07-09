import { createFileRoute } from '@tanstack/react-router'
import { HomeScreen } from '../components/Home'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="min-h-screen bg-slate-50">
      <HomeScreen />
    </main>
  )
}
