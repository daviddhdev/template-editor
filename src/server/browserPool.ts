
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
