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
import { storesHydrated, useWorkspace } from '../state/workspaceStore'
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
import { formatIssuesNotice, loadDataIntoWorkspace, missingColumnsNotice } from '../lib/loadData'
import { authGuard } from '../lib/authRedirect'
import { googleStatusFn, type GoogleStatus } from '../server/google'
import { GenerationHistory } from './GenerationHistory'
import { GoogleConnect } from './GoogleConnect'
import { Button, ConfirmDialog, ErrorNote, Spinner, TextInput, Toast, useDialogChrome } from './ui'

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

/** Decorative-only "sticker" colours for the card icons, cycled per card. */
const CARD_ACCENTS = [
  'text-accent-orange',
  'text-accent-teal',
  'text-accent-pink',
  'text-accent-sky',
  'text-accent-purple',
  'text-accent-green',
]

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
      const res = authGuard(await listRecipesFn())
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

  // Session/Drive chip in the header (same as the editor's): shows who is
  // logged in and offers reconnect when Drive permissions are missing.
  const [google, setGoogle] = useState<GoogleStatus | null>(null)
  const refreshGoogle = useCallback(() => {
    googleStatusFn()
      .then((res) => setGoogle(res.ok ? res.data : null))
      .catch(() => setGoogle(null))
  }, [])
  useEffect(refreshGoogle, [refreshGoogle])

  // Wait for the authed layout's hydration, migrate any localStorage-era
  // templates into the database (one-time), then list the library.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await storesHydrated()
      const legacy = useRecipes.getState().recipes
      if (legacy.length > 0) {
        let migrated = 0
        for (const r of legacy) {
          const { id: _id, savedAt: _at, ...input } = r
          const res = await saveRecipeFn({ data: { recipe: input } }).catch(() => null)
          if (!res?.ok) break // DB down: the REST stays in localStorage, retried next visit
          // Drop each recipe as soon as ITS save succeeds: a failure later in
          // the loop must not re-insert the already-migrated ones next visit.
          useRecipes.getState().remove(r.id)
          migrated++
        }
        if (migrated > 0) {
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
          notify(
            `Plantilla lista: ${dataRes.rows} filas de datos${tab}.` +
              missingColumnsNotice(dataRes.missingColumns) +
              formatIssuesNotice(dataRes.formatIssues),
          )
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
    <div className="mx-auto flex min-h-screen max-w-[90rem] flex-col gap-6 px-10 py-8">
      <header className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-sky text-white shadow-e1">
            <FileStack className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              Generador de documentos
            </h1>
            <p className="text-sm text-ink-muted">Tus plantillas y tu trabajo reciente</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar plantilla…"
              aria-label="Buscar plantilla por nombre"
              className="h-10 w-64 rounded-lg border border-input-border bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-primary focus:ring-2 focus:ring-primary/10"
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
          <GoogleConnect status={google} onChanged={refreshGoogle} />
        </div>
      </header>

      {hasDraft ? (
        <button
          onClick={() => void navigate({ to: '/editor' })}
          className="flex w-full items-center gap-4 rounded-xl border border-hairline bg-surface px-4 py-4 text-left shadow-e1 outline-none transition hover:shadow-e2 focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span
            aria-hidden
            className="flex h-[50px] w-10 shrink-0 flex-col gap-[3px] rounded-md border border-hairline bg-canvas-soft px-1.5 py-[7px]"
          >
            <span className="h-[2px] rounded-full bg-primary/60" />
            <span className="h-[2px] w-4/5 rounded-full bg-ink-faint/50" />
            <span className="h-[2px] rounded-full bg-ink-faint/50" />
            <span className="h-[2px] w-3/5 rounded-full bg-ink-faint/50" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-wide text-primary">
              Continuar donde lo dejaste
            </span>
            <span className="mt-0.5 block truncate text-base font-semibold text-ink">
              {editorTitle || 'Documento'}
            </span>
            <span className="block truncate text-sm text-ink-muted">
              Trabajo sin guardar de tu última sesión
            </span>
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-medium text-primary shadow-e1">
            Reanudar
            <ArrowRight className="h-4 w-4" />
          </span>
        </button>
      ) : null}

      {dbError ? <ErrorNote title={dbError.error} hint={dbError.hint} /> : null}

      <section>
        <div className="mb-4 flex items-center gap-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Mis plantillas
          </h2>
          {summaries ? (
            <span className="rounded-full border border-hairline bg-surface px-2 py-px text-xs font-semibold text-ink-muted">
              {summaries.length}
            </span>
          ) : null}
        </div>

        {summaries === null ? (
          <Spinner label="Cargando la biblioteca…" />
        ) : shown.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {summaries.length === 0
              ? 'Aún no hay plantillas guardadas. Crea una nueva y usa «Guardar plantilla» en el editor.'
              : 'Ninguna plantilla coincide con la búsqueda.'}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-5">
            {shown.map((s, i) => (
              <div
                key={s.id}
                className="group relative overflow-hidden rounded-xl border border-hairline bg-surface shadow-e1 transition hover:shadow-e2"
              >
                <button
                  onClick={() => !busy && openRecipe(s.id)}
                  className="block w-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`Abrir la plantilla ${s.name}`}
                >
                  <div className="flex h-[11.5rem] items-start justify-center overflow-hidden border-b border-hairline bg-canvas-soft">
                    {s.thumbnail ? (
                      <img
                        src={`data:image/png;base64,${s.thumbnail}`}
                        alt=""
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <FileText className="mt-14 h-12 w-12 text-ink-faint/50" />
                    )}
                  </div>
                </button>
                <div className="flex items-center gap-2.5 px-3.5 py-3">
                  <FileText className={`h-4 w-4 shrink-0 ${CARD_ACCENTS[i % CARD_ACCENTS.length]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink" title={s.name}>
                      {s.name}
                    </p>
                    <p className="text-xs text-ink-faint">
                      Actualizada el {dateFmt.format(new Date(s.updatedAt))}
                    </p>
                  </div>
                  <button
                    onClick={() => setMenuFor(s)}
                    aria-label={`Opciones de la plantilla ${s.name}`}
                    className="rounded-lg p-1.5 text-ink-faint outline-none hover:bg-black/5 hover:text-ink-secondary focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <GenerationHistory />

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
            if (res?.ok) {
              // The draft may be linked to this row: unlink so "Guardar
              // cambios" doesn't target a template that no longer exists.
              const ws = useWorkspace.getState()
              if (ws.savedRecipe?.id === deleting.id) ws.setSavedRecipe(null)
              notify('Plantilla eliminada.')
            }
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
  const dialogRef = useDialogChrome(onClose)
  const item =
    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-ink-secondary outline-none hover:bg-canvas-soft focus-visible:ring-2 focus-visible:ring-primary'
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-label={`Opciones de ${summary.name}`}
        className="w-full max-w-xs rounded-xl border border-hairline bg-surface p-2 shadow-e2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="truncate px-3 py-1.5 text-xs font-semibold text-ink-muted">{summary.name}</p>
        <button onClick={onOpen} className={item} autoFocus>
          <FolderOpen className="h-4 w-4 text-primary" /> Abrir en el editor
        </button>
        <button onClick={onDuplicate} className={item}>
          <Copy className="h-4 w-4 text-ink-muted" /> Duplicar
        </button>
        <button onClick={onRename} className={item}>
          <Pencil className="h-4 w-4 text-ink-muted" /> Renombrar
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
  const dialogRef = useDialogChrome(onClose)
  const [name, setName] = useState(summary.name)
  const [busy, setBusy] = useState(false)

  async function rename() {
    setBusy(true)
    const res = await renameRecipeFn({ data: { id: summary.id, name } }).catch(() => null)
    setBusy(false)
    if (res?.ok) {
      // Keep the linked draft's name in sync (shown by the save dialog).
      const ws = useWorkspace.getState()
      if (ws.savedRecipe?.id === summary.id) {
        ws.setSavedRecipe({ id: summary.id, name: name.trim() || 'Sin nombre' })
      }
      onRenamed()
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Renombrar plantilla"
        className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-5 shadow-e2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-ink">Renombrar plantilla</p>
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
