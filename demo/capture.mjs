import { chromium } from 'playwright'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = path.join(ROOT, 'demo', 'output')
const RAW = path.join(OUTPUT, 'raw')
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'
const SERVER_FN_PREFIX = '/_serverFn/'
const GENERATE_PDF_FN = {
  file: '/src/server/pdf.ts?tss-serverfn-split',
  export: 'generatePdfFn_createServerFn_handler',
}
const RUN_LOG = path.join(OUTPUT, 'capture.log')

function loopbackOrigin(rawValue) {
  let url
  try {
    url = new URL(rawValue)
  } catch {
    throw new Error('DEMO_BASE_URL debe ser una URL HTTP de loopback')
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new Error('DEMO_BASE_URL debe ser una URL HTTP de loopback sin credenciales')
  }
  return url.origin
}

const BASE = loopbackOrigin(process.env.DEMO_BASE_URL ?? DEFAULT_BASE_URL)

async function log(message) {
  await appendFile(RUN_LOG, `${new Date().toISOString()} ${message}\n`, 'utf8')
}

// TanStack serializes server-function arguments as a small tagged JSON tree.
// Decode the handful of node types used by the PDF payload so the harness can
// render the real resolved HTML without depending on private server internals.
function decodeServerValue(node) {
  if (node === null || node === undefined) return node
  if (node.t === 1) return node.s
  if (node.t === 2) return null
  if (node.t === 9) return (node.a ?? []).map(decodeServerValue)
  if (node.t === 10) {
    const keys = node.p?.k ?? []
    const values = node.p?.v ?? []
    return Object.fromEntries(keys.map((key, i) => [key, decodeServerValue(values[i])]))
  }
  return node.s ?? node.v ?? null
}

// The controlled PDF payload from this deterministic demo arrives with a
// second, display-oriented escaping layer inside `html` (for example
// `\\x3C!doctype html>\\n`). Decode only the escape forms emitted by the app,
// before handing the controlled demo HTML to Chromium. The loopback and exact
// generatePdfFn route checks below are required before this renderer is used.
function normalizeJobHtml(value) {
  if (typeof value !== 'string') return value
  return value
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function decodeServerFnId(requestUrl) {
  let endpoint
  try {
    endpoint = new URL(requestUrl)
  } catch {
    return null
  }
  if (endpoint.origin !== BASE || endpoint.search || endpoint.hash) return null
  if (!endpoint.pathname.startsWith(SERVER_FN_PREFIX)) return null
  const segment = endpoint.pathname.slice(SERVER_FN_PREFIX.length)
  if (!segment || segment.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(segment)) return null
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (segment.length % 4)) % 4)
  try {
    const identity = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
    return identity.file === GENERATE_PDF_FN.file && identity.export === GENERATE_PDF_FN.export
      ? identity
      : null
  } catch {
    return null
  }
}

const rows = [
  { Cliente: 'Acme Servicios', Caso: 'Revisión de contrato', Importe: '1250', Accion: 'Validar la documentación', Estado: 'Pendiente', Fecha: '2026-09-03' },
  { Cliente: 'Acme Servicios', Caso: 'Alta de proveedor', Importe: '480', Accion: 'Enviar confirmación', Estado: 'En curso', Fecha: '2026-09-03' },
  { Cliente: 'Boreal Logística', Caso: 'Actualización de dirección', Importe: '320', Accion: 'Solicitar comprobante', Estado: 'Pendiente', Fecha: '2026-09-03' },
  { Cliente: 'Cobalto Salud', Caso: 'Renovación anual', Importe: '2100', Accion: 'Preparar propuesta', Estado: 'Cerrado', Fecha: '2026-09-03' },
]

const condition = {
  id: 'demo-condicion-seguimiento',
  label: 'Aviso de seguimiento',
  branches: [{ id: 'demo-rama-pendiente', column: 'Estado', operator: 'equals', value: 'Pendiente', text: '⚠ Requiere seguimiento prioritario' }],
  defaultText: '✓ Seguimiento normal',
}

const editorHtml = `<h1>Parte de seguimiento</h1>
<p><strong>Cliente:</strong> {{Cliente}}</p>
<p><strong>Fecha de revisión:</strong> {{Fecha}}</p>
<p class="ttg-cond" data-cond="${encodeURIComponent(JSON.stringify(condition))}">Aviso de seguimiento</p>
<div data-ttg-repeat="true">
  <p><strong>Incidencia:</strong> {{Caso}}</p>
  <p><strong>Importe estimado:</strong> {{Importe}}</p>
  <p><strong>Próxima acción:</strong> {{Accion}}</p>
</div>
<p><strong>Estado:</strong> {{Estado}}</p>`

const editorCss = `
  html, body { background: #ffffff; }
  body { box-sizing: border-box; width: 760px; max-width: 760px; margin: 0 auto; padding: 48px 56px; color: #1f2937; font-family: Arial, sans-serif; font-size: 16px; line-height: 1.45; }
  h1 { margin: 0 0 24px; color: #0f3d56; font-size: 30px; }
  p { margin: 0 0 12px; }
  [data-ttg-repeat="true"] { margin: 22px 0; padding: 16px 20px 4px; border-left: 4px solid #f59e0b; border-radius: 8px; background: #fff8e7; }
  .ttg-cond { margin: 20px 0; padding: 10px 14px; border-radius: 8px; background: #e8f3f7; color: #0f3d56; font-weight: 600; }
`

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function setCaption(page, text) {
  await page.evaluate((value) => {
    const caption = document.querySelector('#demo-caption')
    if (caption) caption.textContent = value
  }, text)
}

async function hold(page, text, ms, screenshotName) {
  await setCaption(page, text)
  if (screenshotName) await page.screenshot({ path: path.join(OUTPUT, screenshotName), animations: 'disabled' })
  await pause(ms)
}

async function seed(page) {
  await page.waitForFunction(() => Boolean(window.__ttgStore), null, { timeout: 15000 })
  await page.evaluate(({ editorHtml, editorCss, rows, condition }) => {
    const store = window.__ttgStore
    const state = store.getState()
    store.setState({
      templateUrl: 'demo://plantilla-local',
      editorHtml,
      editorCss,
      editorTitle: 'Parte de seguimiento',
      editorBodyClass: '',
      docToken: state.docToken + 1,
      sourceFile: null,
      dataKind: 'google_sheet',
      dataUrl: 'demo://datos-incidencias',
      apiConfig: null,
      data: {
        kind: 'google_sheet',
        origin: 'demo://datos-incidencias',
        columns: ['Cliente', 'Caso', 'Importe', 'Accion', 'Estado', 'Fecha'],
        rows,
      },
      sheetTabs: [],
      mapping: { Cliente: 'Cliente', Caso: 'Caso', Importe: 'Importe', Accion: 'Accion', Estado: 'Estado', Fecha: 'Fecha' },
      ruleBindings: {},
      tagFormats: { Importe: 'moneda', Fecha: 'fecha_larga' },
      group: { mode: 'per_group', groupByColumn: 'Cliente' },
      outputFolderUrl: '',
      savedRecipe: null,
      view: 'edit',
      notice: null,
      noticeToken: state.noticeToken,
      history: { past: [], future: [] },
    })
  }, { editorHtml, editorCss, rows, condition })
  await page.waitForFunction(() => Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('.ttg-chip')), null, { timeout: 15000 })
}

async function addOverlay(page) {
  await page.addStyleTag({ content: `
    #demo-badge { position: fixed; top: 14px; left: 18px; z-index: 2147483646; padding: 7px 12px; border-radius: 999px; background: rgba(15, 61, 86, .94); color: white; font: 700 13px/1.1 Arial, sans-serif; letter-spacing: .06em; }
    #demo-caption { position: fixed; left: 7%; right: 7%; bottom: 22px; z-index: 2147483647; min-height: 42px; padding: 14px 22px; border: 1px solid rgba(255,255,255,.35); border-radius: 12px; background: rgba(15, 23, 42, .94); color: white; text-align: center; font: 600 21px/1.25 Arial, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.22); }
  ` })
  await page.evaluate(() => {
    const badge = document.createElement('div')
    badge.id = 'demo-badge'
    badge.textContent = 'DEMO INTERNA · SIN DATOS REALES'
    const caption = document.createElement('div')
    caption.id = 'demo-caption'
    caption.textContent = 'Preparando la historia…'
    document.body.append(badge, caption)
  })
}

async function main() {
  await mkdir(RAW, { recursive: true })
  await mkdir(OUTPUT, { recursive: true })
  await writeFile(RUN_LOG, '', 'utf8')
  await log('launch')
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: RAW, size: { width: 1920, height: 1080 } },
  })
  // The app's local PDF endpoint normally launches its own Playwright browser.
  // In constrained demo environments that child process may not be available,
  // so the harness fulfills only the exact local generatePdfFn request using a
  // second, non-recorded context. The UI and plan still come from the real app;
  // no Google/Drive/native endpoint is intercepted.
  const pdfContext = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const page = await context.newPage()
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('[browser]', msg.text()) })
  await page.route('**/_serverFn/**', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST' || !decodeServerFnId(request.url())) {
      await route.continue()
      return
    }
    const body = request.postData() ?? ''
    try {
      const payload = decodeServerValue(JSON.parse(body).t)
      const jobs = payload?.data?.jobs ?? []
      if (!Array.isArray(jobs) || jobs.length === 0 || jobs.some((job) => !job || typeof job.html !== 'string')) {
        await route.continue()
        return
      }
      await log(`pdf-intercept generatePdfFn jobs=${jobs.length}`)
      const renderPage = await pdfContext.newPage()
      const files = []
      try {
        for (const job of jobs) {
          await renderPage.setContent(normalizeJobHtml(job.html), { waitUntil: 'networkidle' })
          const margin = await renderPage.evaluate(`(() => {
            const cs = getComputedStyle(document.body)
            const val = (v) => (v && parseFloat(v) > 0 ? v : '20mm')
            return { top: val(cs.paddingTop), right: val(cs.paddingRight), bottom: val(cs.paddingBottom), left: val(cs.paddingLeft) }
          })()`)
          await renderPage.addStyleTag({ content: 'html{margin:0 !important;padding:0 !important;}body{margin:0 auto !important;padding:0 !important;}' })
          const pdf = await renderPage.pdf({ format: 'A4', printBackground: true, margin })
          const safeName = String(job.name ?? 'documento').replace(/[^a-z0-9áéíóúüñ _-]/gi, '_').trim() || 'documento'
          const name = `${safeName}.pdf`
          await writeFile(path.join(OUTPUT, `resultado-${safeName}.pdf`), pdf)
          files.push({ name, base64: Buffer.from(pdf).toString('base64') })
        }
      } finally {
        await renderPage.close()
      }
      await route.fulfill({
        status: 200,
        // The demo harness returns the ordinary server-function envelope.  Do
        // not mark it as a seroval payload: that header makes the client try
        // to decode this already-JSON object as a tagged transport value.
        headers: { 'content-type': 'application/json' },
        // Server functions return an envelope with `result`; the client-side
        // RPC wrapper unwraps this before GenerateDialog sees it.
        body: JSON.stringify({ result: { ok: true, data: { files } } }),
      })
    } catch (error) {
      await writeFile(path.join(OUTPUT, 'capture-pdf-error.txt'), String(error?.stack ?? error), 'utf8')
      await route.fulfill({ status: 500, body: 'Demo PDF render failed' })
    }
  })
  try {
    await log('goto')
    await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await log('seed')
    await seed(page)
    await log('overlay')
    await addOverlay(page)

    await log('scene-1')
    await hold(page, '1 · Plantilla: un documento visual con campos reutilizables', 12000, 'frame-01-plantilla.png')

    const firstChip = page.frameLocator('iframe[title="Editor de plantilla"]').locator('.ttg-chip').first()
    await log('scene-2')
    await firstChip.click()
    await hold(page, '2 · Los campos quedan vinculados a columnas de los datos', 10000, 'frame-02-vinculos.png')
    await page.keyboard.press('Escape')
    await log('scene-3')
    await page.frameLocator('iframe[title="Editor de plantilla"]').locator('.ttg-cond').click()
    await hold(page, '3 · Una condición decide qué aviso mostrar según el estado', 11000, 'frame-03-condicion.png')
    await page.keyboard.press('Escape')

    await log('scene-4')
    await page.getByRole('button', { name: 'Vista previa', exact: true }).click()
    await page.waitForFunction(() => Boolean(document.querySelector('iframe[title="Vista previa del documento"]')), null, { timeout: 10000 })
    await hold(page, '4 · Vista previa: el mismo diseño ya resuelto con los datos ficticios', 16000, 'frame-04-preview.png')

    const previewSelect = page.locator('label').filter({ hasText: 'Ver documento' }).locator('select')
    if (await previewSelect.count()) {
      await previewSelect.selectOption('1')
      await hold(page, '5 · Cambiamos de grupo y comprobamos otra salida antes de generar', 10000, 'frame-05-preview-grupo.png')
    }

    await log('scene-6')
    await page.getByRole('button', { name: 'Editar', exact: true }).click()
    await page.getByRole('button', { name: 'Generar PDF', exact: true }).click()
    await hold(page, '6 · Generación: se preparan tres documentos, uno por cliente', 12000, 'frame-06-generar-checklist.png')
    await page.getByRole('button', { name: /^Generar PDF$/ }).last().click()
    await page.getByText(/Listo — 3 documentos generados/, { exact: true }).waitFor({ timeoutMs: 90000 }).catch(async () => {
      await page.waitForTimeout(4000)
    })
    await hold(page, '7 · Resultado: documentos listos para descargar en PDF', 16000, 'frame-07-resultado.png')
  } finally {
    await log('closing')
    const video = page.video()
    await context.close()
    const rawPath = video ? await video.path() : null
    await pdfContext.close()
    await browser.close()
    if (rawPath) {
      await writeFile(path.join(OUTPUT, 'raw-video-path.txt'), `${rawPath}\n`, 'utf8')
      console.log(`RAW_VIDEO=${rawPath}`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  void writeFile(path.join(OUTPUT, 'capture-error.txt'), String(error?.stack ?? error), 'utf8')
  process.exitCode = 1
})
