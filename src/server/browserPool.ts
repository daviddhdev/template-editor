/**
 * Shared Chromium instance (SERVER ONLY — import this module DYNAMICALLY from
 * inside server-function handlers; a static import from a file the client
 * also imports would drag playwright into the browser bundle and break the
 * build). Closed after a short idle: the generate dialog sends one document
 * per request for live progress, and launching a fresh browser per request
 * would add ~1s to every document of a batch.
 *
 * Reference-counted: the idle close only arms once the LAST concurrent user
 * releases (a timer armed while another request still rendered used to be
 * able to kill the browser mid-render). Used by pdf.ts and by the recipe
 * thumbnail in recipesDb.ts.
 */

let sharedBrowser: Promise<import('playwright').Browser> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let activeUsers = 0

export async function acquireBrowser(): Promise<import('playwright').Browser> {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  activeUsers++
  try {
    if (!sharedBrowser) {
      sharedBrowser = import('playwright').then(({ chromium }) => chromium.launch())
    }
    try {
      const browser = await sharedBrowser
      if (!browser.isConnected()) throw new Error('browser disconnected')
      return browser
    } catch {
      // Launch failed or the browser died between requests — relaunch once.
      sharedBrowser = import('playwright').then(({ chromium }) => chromium.launch())
      return await sharedBrowser
    }
  } catch (err) {
    activeUsers = Math.max(0, activeUsers - 1)
    throw err
  }
}

export function releaseBrowser(): void {
  activeUsers = Math.max(0, activeUsers - 1)
  if (activeUsers > 0) return
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    const b = sharedBrowser
    sharedBrowser = null
    void b?.then((browser) => browser.close()).catch(() => {})
  }, 20_000)
}
