import type { DataSourceKind } from '../types'
import { fetchDataFn, listSheetTabsFn, type SheetTab } from '../server/fetch'
import { useWorkspace } from '../state/workspaceStore'
import { extractSheetGid } from './url'

export type LoadDataResult =
  | { ok: true; rows: number; columns: number; tabTitle: string | null; multiTab: boolean }
  | { ok: false; error: string; hint?: string }

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
  }
}
