import { createFileRoute } from '@tanstack/react-router'
import { ManualForm } from '../components/ManualForm'

export const Route = createFileRoute('/_authed/form/$recipeId')({ component: FormRoute })

function FormRoute() {
  const { recipeId } = Route.useParams()
  return <main className="min-h-screen bg-canvas-soft"><ManualForm recipeId={recipeId} /></main>
}
