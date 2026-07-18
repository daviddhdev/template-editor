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
      /** Columns bound somewhere (campos, agrupación, reglas) but absent from
       * the data just loaded — typically after switching sheet tabs. */
      missingColumns: string[]
      /** Formatted columns with cells the format cannot parse (pass through). */
      formatIssues: FormatIssue[]
    }
  | { ok: false; error: string; hint?: string }

/** Warning sentence for `missingColumns`, or '' — appended by the callers to
 * their single success toast (notices are one-at-a-time, no stacking). */
export function missingColumnsNotice(missing: string[]): string {
  if (missing.length === 0) return ''
  const list = missing.map((c) => `«${c}»`).join(', ')
  return missing.length === 1
    ? ` Ojo: aquí falta la columna ${list}, usada por campos, agrupación o reglas — queda sin efecto hasta reasignarla o volver a la pestaña anterior.`
    : ` Ojo: aquí faltan las columnas ${list}, usadas por campos, agrupación o reglas — quedan sin efecto hasta reasignarlas o volver a la pestaña anterior.`
}

/** Warning sentence for `formatIssues`, or '' — appended to the load toast
 * like {@link missingColumnsNotice} (notices are one-at-a-time). */
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

/**
 * Load the data source into the store, together with the spreadsheet's tab
 * list (so the UI can show WHICH tab fed the data and offer switching).
 * Shared by the top bar and by loading a saved template.
 */
export async function loadDataIntoWorkspace(
  kind: DataSourceKind,
  origin: string,
): Promise<LoadDataResult> {
  // API source: send its config (and the saved recipe id, so the server can
  // decrypt stored credentials when the login body came back redacted).
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
    // Keep any tab list: switching tabs may be exactly what fixes the error
    // (e.g. the link points at a deleted tab).
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
