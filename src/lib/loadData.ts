import type { DataSourceKind } from '../types'
import { fetchDataFn, listSheetTabsFn, type SheetTab } from '../server/fetch'
import { useWorkspace } from '../state/workspaceStore'
import { missingBoundColumns } from './plan'
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

/**
 * Load the data source into the store, together with the spreadsheet's tab
 * list (so the UI can show WHICH tab fed the data and offer switching).
 * Shared by the top bar and by loading a saved template.
 */
export async function loadDataIntoWorkspace(
  kind: DataSourceKind,
  origin: string,
): Promise<LoadDataResult> {
  const [res, tabsRes] = await Promise.all([
    fetchDataFn({ data: { kind, origin } }),
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
  }
}
