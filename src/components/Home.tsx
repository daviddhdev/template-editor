import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Copy,
  FilePlus2,
  FileStack,
  FileText,
  FolderOpen,
  MoreVertical,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react'
import { rehydrateStores, useWorkspace } from '../state/workspaceStore'
import { useRecipes } from '../state/recipesStore'
import {
  deleteRecipeFn,
  duplicateRecipeFn,
  getRecipeFn,
  listRecipesFn,
  renameRecipeFn,
  saveRecipeFn,
  type RecipeSummary,
} from '../server/recipesDb'
import { loadDataIntoWorkspace } from '../lib/loadData'
import { Button, ConfirmDialog, ErrorNote, Spinner, TextInput, Toast, useDialogChrome } from './ui'

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Home screen, Drive-style: recent work first. A highlighted "continue where
 * you left off" card (the autosaved workspace) plus the template library from
 * the database as thumbnail cards. The editor lives at /editor.
 */
export function HomeScreen() {
  const navigate = useNavigate()
  const { editorHtml, editorTitle, notice, noticeToken, clearNotice, notify, reset } =
    useWorkspace()

  const [summaries, setSummaries] = useState<RecipeSummary[] | null>(null)
  const [dbError, setDbError] = useState<{ error: string; hint?: string } | null>(null)
  const [filter, setFilter] = useState('')
  const [menuFor, setMenuFor] = useState<RecipeSummary | null>(null)
  const [renaming, setRenaming] = useState<RecipeSummary | null>(null)
  const [deleting, setDeleting] = useState<RecipeSummary | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await listRecipesFn()
      if (res.ok) {
        setSummaries(res.data)
        setDbError(null)
      } else {
        setSummaries([])
        setDbError(res)
      }
    } catch {
      setSummaries([])
      setDbError({ error: 'No se pudo cargar la biblioteca de plantillas.' })
    }
  }, [])

  // Hydrate the persisted stores, migrate any localStorage-era templates into
  // the database (one-time), then list the library.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await rehydrateStores()
      const legacy = useRecipes.getState().recipes
      if (legacy.length > 0) {
        let migrated = 0
        for (const r of legacy) {
          const { id: _id, savedAt: _at, ...input } = r
          const res = await saveRecipeFn({ data: { recipe: input } }).catch(() => null)
          if (res?.ok) migrated++
          else break // DB down: keep everything in localStorage, retry next visit
        }
        if (migrated === legacy.length) {
          useRecipes.setState({ recipes: [] })
          notify(
            `${migrated} ${migrated === 1 ? 'plantilla migrada' : 'plantillas migradas'} de este navegador a la base de datos.`,
          )
        }
      }
      if (!cancelled) await refresh()
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  async function openRecipe(id: string) {
    setBusy(true)
    try {
      const res = await getRecipeFn({ data: { id } })
      if (!res.ok) {
        setDbError(res)
        return
      }
      useWorkspace.getState().loadRecipe(res.data)
      notify(`Plantilla «${res.data.name}» abierta.`)
      void navigate({ to: '/editor' })
      // Rows are per-batch: re-read them from the saved source right away.
      if (res.data.dataUrl.trim()) {
        const dataRes = await loadDataIntoWorkspace(res.data.dataKind, res.data.dataUrl.trim())
        if (dataRes.ok) {
          const tab = dataRes.multiTab && dataRes.tabTitle ? ` (pestaña «${dataRes.tabTitle}»)` : ''
          notify(`Plantilla lista: ${dataRes.rows} filas de datos${tab}.`)
        } else {
          notify(`Plantilla abierta, pero los datos no: ${dataRes.error}`)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const shown = (summaries ?? []).filter((s) =>
    s.name.toLowerCase().includes(filter.trim().toLowerCase()),
  )
  const hasDraft = editorHtml.trim().length > 0

  return (
    <div className="mx-auto flex min-h-screen max-w-[90rem] flex-col gap-5 px-6 py-6">
      <header className="flex items-center gap-2">
        <FileStack className="h-6 w-6 text-indigo-600" />
        <h1 className="text-lg font-bold text-slate-900">Generador de documentos</h1>
        <span className="text-sm text-slate-500">— tus plantillas y tu trabajo reciente</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar plantilla…"
              aria-label="Buscar plantilla por nombre"
              className="w-56 rounded-full border border-slate-300 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <Button
            onClick={() => {
              reset()
              void navigate({ to: '/editor' })
            }}
          >
            <FilePlus2 className="h-4 w-4" /> Nueva plantilla
          </Button>
        </div>
      </header>

      {hasDraft ? (
        <button
          onClick={() => void navigate({ to: '/editor' })}
          className="flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-left outline-none hover:bg-indigo-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <FileText className="h-5 w-5 shrink-0 text-indigo-600" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-indigo-900">
              Continuar donde lo dejaste
            </span>
            <span className="block truncate text-xs text-indigo-700">
              {editorTitle || 'Documento'} — el trabajo sin guardar de tu última sesión
            </span>
          </span>
          <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-indigo-500" />
        </button>
      ) : null}

      {dbError ? <ErrorNote title={dbError.error} hint={dbError.hint} /> : null}

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Mis plantillas {summaries ? `(${summaries.length})` : ''}
        </h2>

        {summaries === null ? (
          <Spinner label="Cargando la biblioteca…" />
        ) : shown.length === 0 ? (
          <p className="text-sm text-slate-500">
            {summaries.length === 0
              ? 'Aún no hay plantillas guardadas. Crea una nueva y usa «Guardar plantilla» en el editor.'
              : 'Ninguna plantilla coincide con la búsqueda.'}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
            {shown.map((s) => (
              <div
                key={s.id}
                className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-indigo-300 hover:shadow-md"
              >
                <button
                  onClick={() => !busy && openRecipe(s.id)}
                  className="block w-full outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  aria-label={`Abrir la plantilla ${s.name}`}
                >
                  <div className="flex h-44 items-start justify-center overflow-hidden border-b border-slate-100 bg-slate-50">
                    {s.thumbnail ? (
                      <img
                        src={`data:image/png;base64,${s.thumbnail}`}
                        alt=""
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <FileText className="mt-14 h-12 w-12 text-slate-300" />
                    )}
                  </div>
                </button>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-indigo-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700" title={s.name}>
                      {s.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      actualizada el {dateFmt.format(new Date(s.updatedAt))}
                    </p>
                  </div>
                  <button
                    onClick={() => setMenuFor(s)}
                    aria-label={`Opciones de la plantilla ${s.name}`}
                    className="rounded-full p-1.5 text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {menuFor ? (
        <CardMenu
          summary={menuFor}
          onClose={() => setMenuFor(null)}
          onOpen={() => {
            setMenuFor(null)
            void openRecipe(menuFor.id)
          }}
          onDuplicate={async () => {
            setMenuFor(null)
            const res = await duplicateRecipeFn({ data: { id: menuFor.id } }).catch(() => null)
            if (res?.ok) notify('Plantilla duplicada.')
            else setDbError(res ?? { error: 'No se pudo duplicar la plantilla.' })
            await refresh()
          }}
          onRename={() => {
            setMenuFor(null)
            setRenaming(menuFor)
          }}
          onDelete={() => {
            setMenuFor(null)
            setDeleting(menuFor)
          }}
        />
      ) : null}

      {renaming ? (
        <RenameDialog
          summary={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={async () => {
            setRenaming(null)
            notify('Plantilla renombrada.')
            await refresh()
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`¿Eliminar «${deleting.name}»?`}
          body="Se borra de la biblioteca para todos; el documento de Google no se toca."
          confirmLabel="Eliminar"
          onConfirm={async () => {
            const res = await deleteRecipeFn({ data: { id: deleting.id } }).catch(() => null)
            setDeleting(null)
            if (res?.ok) notify('Plantilla eliminada.')
            else setDbError(res ?? { error: 'No se pudo eliminar la plantilla.' })
            await refresh()
          }}
          onCancel={() => setDeleting(null)}
        />
      ) : null}

      <Toast text={notice} token={noticeToken} onDismiss={clearNotice} />
    </div>
  )
}

/** Per-card actions menu (Drive's ⋮). */
function CardMenu({
  summary,
  onClose,
  onOpen,
  onDuplicate,
  onRename,
  onDelete,
}: {
  summary: RecipeSummary
  onClose: () => void
  onOpen: () => void
  onDuplicate: () => void
  onRename: () => void
  onDelete: () => void
}) {
  useDialogChrome(onClose)
  const item =
    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500'
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Opciones de ${summary.name}`}
        className="w-full max-w-xs rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="truncate px-3 py-1.5 text-xs font-semibold text-slate-500">{summary.name}</p>
        <button onClick={onOpen} className={item} autoFocus>
          <FolderOpen className="h-4 w-4 text-indigo-500" /> Abrir en el editor
        </button>
        <button onClick={onDuplicate} className={item}>
          <Copy className="h-4 w-4 text-slate-500" /> Duplicar
        </button>
        <button onClick={onRename} className={item}>
          <Pencil className="h-4 w-4 text-slate-500" /> Renombrar
        </button>
        <button onClick={onDelete} className={`${item} text-red-600 hover:bg-red-50`}>
          <Trash2 className="h-4 w-4" /> Eliminar
        </button>
      </div>
    </div>
  )
}

function RenameDialog({
  summary,
  onClose,
  onRenamed,
}: {
  summary: RecipeSummary
  onClose: () => void
  onRenamed: () => void
}) {
  useDialogChrome(onClose)
  const [name, setName] = useState(summary.name)
  const [busy, setBusy] = useState(false)

  async function rename() {
    setBusy(true)
    const res = await renameRecipeFn({ data: { id: summary.id, name } }).catch(() => null)
    setBusy(false)
    if (res?.ok) onRenamed()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Renombrar plantilla"
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-slate-800">Renombrar plantilla</p>
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && rename()}
          aria-label="Nuevo nombre"
          autoFocus
          className="mt-3"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={rename} disabled={busy || !name.trim()}>
            {busy ? <Spinner /> : 'Renombrar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
