import type { DataSourceKind } from '../types'
import { fetchDataFn, listSheetTabsFn, type SheetTab } from '../server/fetch'
import { useWorkspace } from '../state/workspaceStore'
import { formatParseIssues, missingBoundColumns, type FormatIssue } from './plan'
import { extractSheetGid } from './url'

export type LoadDataResult =
  | {
      ok: true
      rows: number
      columns: number
      tabTitle: string | null
      multiTab: boolean
      missingColumns: string[]
      formatIssues: FormatIssue[]
    }
  | { ok: false; error: string; hint?: string }

export function missingColumnsNotice(missing: string[]): string {
  if (missing.length === 0) return ''
  const list = missing.map((c) => `«${c}»`).join(', ')
  return missing.length === 1
    ? ` Ojo: aquí falta la columna ${list}, usada por campos, agrupación o reglas — queda sin efecto hasta reasignarla o volver a la pestaña anterior.`
    : ` Ojo: aquí faltan las columnas ${list}, usadas por campos, agrupación o reglas — quedan sin efecto hasta reasignarlas o volver a la pestaña anterior.`
}

export function formatIssuesNotice(issues: FormatIssue[]): string {
  if (issues.length === 0) return ''
  const parts = issues.map((i) => {
    const what =
      i.kind === 'date'
        ? i.bad === 1
          ? 'no parece una fecha'
          : 'no parecen fechas'
        : i.bad === 1
          ? 'no parece un importe'
          : 'no parecen importes'
    return `${i.bad} ${i.bad === 1 ? 'celda' : 'celdas'} de «${i.column}» ${what} (p. ej. «${i.example}»)`
  })
  return ` Ojo: ${parts.join('; ')} — saldrán tal cual, sin el formato elegido.`
}

export async function loadDataIntoWorkspace(
  kind: DataSourceKind,
  origin: string,
): Promise<LoadDataResult> {
  const pre = useWorkspace.getState()
  const apiConfig = kind === 'api_endpoint' ? (pre.apiConfig ?? undefined) : undefined
  const recipeId = pre.savedRecipe?.id
  const [res, tabsRes] = await Promise.all([
    fetchDataFn({ data: { kind, origin, apiConfig, recipeId } }),
    kind === 'google_sheet'
      ? listSheetTabsFn({ data: { origin } }).catch(() => ({ ok: true as const, data: [] as SheetTab[] }))
      : Promise.resolve({ ok: true as const, data: [] as SheetTab[] }),
  ])

  const tabs = tabsRes.ok ? tabsRes.data : []
  if (!res.ok) {
    useWorkspace.getState().setSheetTabs(tabs)
    return res
  }

  const store = useWorkspace.getState()
  store.setData(res.data)
  store.setSheetTabs(tabs)

  const gid = extractSheetGid(origin)
  const tab = tabs.length > 0 ? (gid ? tabs.find((t) => t.gid === gid) : tabs[0]) : undefined
  return {
    ok: true,
    rows: res.data.rows.length,
    columns: res.data.columns.length,
    tabTitle: tab?.title ?? null,
    multiTab: tabs.length > 1,
    missingColumns: missingBoundColumns(
      store.mapping,
      store.group,
      store.ruleBindings,
      res.data.columns,
    ),
    formatIssues: formatParseIssues(
      store.tagFormats,
      store.mapping,
      res.data.columns,
      res.data.rows,
    ),
  }
}
