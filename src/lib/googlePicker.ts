
export type PickerKind = 'document' | 'spreadsheet' | 'folder'

export interface PickedFile {
  id: string
  name: string
  mimeType: string
}

export interface PickerCredentials {
  accessToken: string
  apiKey: string
}

const DOC_MIME = 'application/vnd.google-apps.document'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export function canonicalPickedUrl(kind: PickerKind, file: PickedFile): string {
  if (kind === 'folder') return `https://drive.google.com/drive/folders/${file.id}`
  if (kind === 'spreadsheet') return `https://docs.google.com/spreadsheets/d/${file.id}/edit`
  return file.mimeType === DOC_MIME
    ? `https://docs.google.com/document/d/${file.id}/edit`
    : `https://drive.google.com/file/d/${file.id}/view`
}


interface PickerNamespace {
  DocsView: new (viewId?: unknown) => {
    setMimeTypes(mimes: string): unknown
    setIncludeFolders(b: boolean): unknown
    setSelectFolderEnabled(b: boolean): unknown
  }
  PickerBuilder: new () => {
    setLocale(l: string): PickerBuilderish
  }
  ViewId: { DOCS: unknown; SPREADSHEETS: unknown; FOLDERS: unknown }
  Action: { PICKED: string; CANCEL: string }
  Response: { ACTION: string; DOCUMENTS: string }
  Document: { ID: string; NAME: string; MIME_TYPE: string }
}

interface PickerBuilderish {
  setLocale(l: string): PickerBuilderish
  setOAuthToken(t: string): PickerBuilderish
  setDeveloperKey(k: string): PickerBuilderish
  setOrigin(o: string): PickerBuilderish
  addView(v: unknown): PickerBuilderish
  setCallback(cb: (data: Record<string, unknown>) => void): PickerBuilderish
  build(): { setVisible(v: boolean): void; dispose(): void }
}

declare global {
  interface Window {
    gapi?: { load(api: string, opts: { callback: () => void; onerror?: () => void }): void }
    google?: { picker?: PickerNamespace }
  }
}

const GAPI_SRC = 'https://apis.google.com/js/api.js'
const LOAD_ERROR = new Error(
  'No se pudo cargar el selector de archivos de Google. Comprueba tu conexión e inténtalo de nuevo.',
)

let pickerApi: Promise<PickerNamespace> | null = null

function loadPickerApi(): Promise<PickerNamespace> {
  if (pickerApi) return pickerApi
  pickerApi = new Promise<PickerNamespace>((resolve, reject) => {
    const fail = () => {
      pickerApi = null // a later click may retry (e.g. connectivity came back)
      reject(LOAD_ERROR)
    }
    const loadModule = () => {
      if (!window.gapi) return fail()
      window.gapi.load('picker', {
        callback: () => (window.google?.picker ? resolve(window.google.picker) : fail()),
        onerror: fail,
      })
    }
    if (window.gapi) return loadModule()
    const script = document.createElement('script')
    script.src = GAPI_SRC
    script.async = true
    script.onload = loadModule
    script.onerror = fail
    document.head.appendChild(script)
  })
  return pickerApi
}

function viewFor(picker: PickerNamespace, kind: PickerKind): unknown {
  if (kind === 'folder') {
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
    view.setIncludeFolders(true)
    view.setSelectFolderEnabled(true)
    view.setMimeTypes(FOLDER_MIME)
    return view
  }
  if (kind === 'spreadsheet') {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS)
    view.setIncludeFolders(true)
    view.setMimeTypes(SHEET_MIME)
    return view
  }
  const view = new picker.DocsView(picker.ViewId.DOCS)
  // Folder navigation hides Google's search field in this view.
  view.setIncludeFolders(true)
  view.setMimeTypes(`${DOC_MIME},${DOCX_MIME}`)
  return view
}

export async function openGooglePicker(
  kind: PickerKind,
  cfg: PickerCredentials,
): Promise<PickedFile | null> {
  const api = await loadPickerApi()
  return new Promise((resolve) => {
    const built = new api.PickerBuilder()
      .setLocale('es')
      .setOAuthToken(cfg.accessToken)
      .setDeveloperKey(cfg.apiKey)
      .setOrigin(window.location.origin)
      .addView(viewFor(api, kind))
      .setCallback((data) => {
        const action = data[api.Response.ACTION]
        if (action === api.Action.PICKED) {
          const docs = data[api.Response.DOCUMENTS] as Record<string, unknown>[] | undefined
          const doc = docs?.[0]
          built.dispose()
          resolve(
            doc
              ? {
                  id: String(doc[api.Document.ID] ?? ''),
                  name: String(doc[api.Document.NAME] ?? ''),
                  mimeType: String(doc[api.Document.MIME_TYPE] ?? ''),
                }
              : null,
          )
        } else if (action === api.Action.CANCEL) {
          built.dispose()
          resolve(null)
        }
      })
      .build()
    built.setVisible(true)
  })
}
