import { useState } from 'react'
import type { ApiSourceConfig } from '../types'
import { probeApiSourceFn, type ApiProbeResult } from '../server/fetch'
import { useWorkspace } from '../state/workspaceStore'
import { Button, ErrorNote, Spinner, TextInput, useDialogChrome } from './ui'

/**
 * Configure an "API externa" data source: the login (token-exchange) and the
 * data endpoint, then a probe that discovers where the records are and which
 * columns exist. Credentials typed here live only in this session's store
 * (authBody); a saved recipe reloads them redacted, and the server fills them
 * from the encrypted copy on probe/load (see server/fetch resolveApiCredentials).
 */
export function ApiSourceDialog({
  onClose,
  onUse,
}: {
  onClose: () => void
  onUse: (dataUrl: string) => void
}) {
  const s = useWorkspace.getState()
  const existing = s.apiConfig
  const recipeId = s.savedRecipe?.id

  const [authUrl, setAuthUrl] = useState(existing?.authUrl ?? '')
  const [authBody, setAuthBody] = useState(existing?.authBody ?? '')
  const [tokenPath, setTokenPath] = useState(existing?.tokenPath ?? '')
  const [dataUrl, setDataUrl] = useState(existing?.dataUrl || s.dataUrl || '')
  const [recordsPath, setRecordsPath] = useState(existing?.recordsPath ?? '')
  const [selectedCols, setSelectedCols] = useState<string[]>(existing?.columns ?? [])
  const authBodyStored = existing?.authBodyStored ?? false

  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<ApiProbeResult | null>(null)
  const [needTokenPath, setNeedTokenPath] = useState(false)
  const [error, setError] = useState<{ error: string; hint?: string } | null>(null)

  const dialogRef = useDialogChrome(() => {
    if (!probing) onClose()
  })

  const candidate = probe?.recordArrays.find((a) => a.path === recordsPath) ?? null
  // Keep the candidate's column order; only include the checked ones.
  const orderedCols = candidate ? candidate.columns.filter((c) => selectedCols.includes(c)) : selectedCols

  function buildConfig(): ApiSourceConfig {
    return {
      authUrl: authUrl.trim(),
      authBody,
      tokenPath: tokenPath.trim(),
      dataUrl: dataUrl.trim(),
      recordsPath,
      columns: orderedCols,
    }
  }

  async function probeApi() {
    setProbing(true)
    setError(null)
    try {
      const res = await probeApiSourceFn({ data: { apiConfig: buildConfig(), recipeId } })
      if (!res.ok) {
        setError(res)
        setProbe(null)
        return
      }
      setProbe(res.data)
      if (!res.data.tokenFound) {
        // Auto-detection failed: ask for the token's path and probe again.
        setNeedTokenPath(true)
        return
      }
      setNeedTokenPath(false)
      // Default to the first candidate list with all its columns selected.
      const first = res.data.recordArrays[0]
      if (first) {
        setRecordsPath(first.path)
        setSelectedCols(first.columns)
      }
    } catch {
      setError({ error: 'No se pudo probar la API. Inténtalo de nuevo.' })
    } finally {
      setProbing(false)
    }
  }

  function selectRecords(path: string) {
    setRecordsPath(path)
    const cand = probe?.recordArrays.find((a) => a.path === path)
    setSelectedCols(cand?.columns ?? [])
  }

  function toggleCol(c: string) {
    setSelectedCols((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))
  }

  function use() {
    const cfg = buildConfig()
    s.setApiConfig(cfg)
    s.setDataUrl(cfg.dataUrl)
    onUse(cfg.dataUrl)
    onClose()
  }

  const canProbe = !probing && dataUrl.trim().length > 0
  const canUse = probe?.tokenFound === true && orderedCols.length > 0

  const labelCls = 'text-xs font-semibold text-ink-secondary'
  const hintCls = 'mt-0.5 text-[11px] text-ink-muted'

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      onClick={() => !probing && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Configurar API externa"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-hairline bg-surface p-5 shadow-e2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-ink">Configurar API externa</p>
        <p className="mt-1 text-xs text-ink-muted">
          Inicia sesión en tu API para obtener un token y lee los datos. Prueba la conexión, elige
          dónde están los registros y qué columnas usar.
        </p>

        {/* Login (token-exchange) */}
        <div className="mt-4 space-y-1">
          <label className={labelCls} htmlFor="api-auth-url">
            Inicio de sesión (opcional)
          </label>
          <TextInput
            id="api-auth-url"
            value={authUrl}
            onChange={(e) => setAuthUrl(e.target.value)}
            placeholder="https://api.tuempresa.com/login"
            disabled={probing}
          />
          <p className={hintCls}>Déjalo vacío si la API de datos no necesita iniciar sesión.</p>
        </div>

        {authUrl.trim() ? (
          <div className="mt-3 space-y-1">
            <label className={labelCls} htmlFor="api-auth-body">
              Credenciales (cuerpo JSON del inicio de sesión)
            </label>
            <textarea
              id="api-auth-body"
              value={authBody}
              onChange={(e) => setAuthBody(e.target.value)}
              placeholder={
                authBodyStored
                  ? 'Credenciales guardadas ••••  (escribe aquí para cambiarlas)'
                  : '{ "username": "…", "password": "…" }'
              }
              rows={3}
              disabled={probing}
              className="w-full rounded-lg border border-input-border bg-surface px-3 py-2 font-mono text-xs text-ink outline-none placeholder:text-ink-faint focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
            <p className={hintCls}>Se guarda cifrado y nunca se muestra de vuelta.</p>
          </div>
        ) : null}

        {needTokenPath ? (
          <div className="mt-3 space-y-1">
            <label className={labelCls} htmlFor="api-token-path">
              No se detectó el token — indica su ruta
            </label>
            <TextInput
              id="api-token-path"
              value={tokenPath}
              onChange={(e) => setTokenPath(e.target.value)}
              placeholder="p. ej. data.access_token"
              disabled={probing}
            />
            <p className={hintCls}>Luego vuelve a pulsar «Probar».</p>
          </div>
        ) : null}

        {/* Data endpoint */}
        <div className="mt-3 space-y-1">
          <label className={labelCls} htmlFor="api-data-url">
            Datos
          </label>
          <TextInput
            id="api-data-url"
            value={dataUrl}
            onChange={(e) => setDataUrl(e.target.value)}
            placeholder="https://api.tuempresa.com/datos"
            disabled={probing}
          />
        </div>

        <div className="mt-4">
          <Button variant="secondary" onClick={probeApi} disabled={!canProbe}>
            {probing ? <Spinner label="Probando…" /> : 'Probar conexión'}
          </Button>
        </div>

        {error ? (
          <div className="mt-3">
            <ErrorNote title={error.error} hint={error.hint} />
          </div>
        ) : null}

        {/* Discovery: pick the records list and its columns */}
        {probe?.tokenFound ? (
          probe.recordArrays.length === 0 ? (
            <p className="mt-4 text-xs text-ink-muted">
              La respuesta no contiene ninguna lista de registros reconocible.
            </p>
          ) : (
            <div className="mt-4 space-y-3 border-t border-hairline pt-4">
              <div className="space-y-1">
                <label className={labelCls} htmlFor="api-records">
                  Lista de registros
                </label>
                <select
                  id="api-records"
                  value={recordsPath}
                  onChange={(e) => selectRecords(e.target.value)}
                  className="h-[38px] w-full rounded-lg border border-hairline bg-canvas-soft px-2.5 text-sm text-ink-secondary outline-none focus:border-primary"
                >
                  {probe.recordArrays.map((a) => (
                    <option key={a.path} value={a.path}>
                      {(a.path || '(raíz)') + ` — ${a.count} registros`}
                    </option>
                  ))}
                </select>
              </div>

              {candidate ? (
                <div className="space-y-1">
                  <p className={labelCls}>Columnas ({orderedCols.length} elegidas)</p>
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-hairline p-2">
                    {candidate.columns.map((c) => (
                      <label key={c} className="flex items-center gap-2 text-xs text-ink">
                        <input
                          type="checkbox"
                          checked={selectedCols.includes(c)}
                          onChange={() => toggleCol(c)}
                        />
                        <span className="font-mono">{c}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={probing}>
            Cancelar
          </Button>
          <Button onClick={use} disabled={!canUse} title={canUse ? undefined : 'Prueba la conexión y elige columnas primero'}>
            Usar estos datos
          </Button>
        </div>
      </div>
    </div>
  )
}
