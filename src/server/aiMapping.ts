import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import type { TagMapping } from '../types'
import { requireArray, requireRecord, requireString, ValidationError } from './validate'
import {
  buildMappingMessages,
  mappingSchema,
  parseMappingContent,
  sampleRowsForMapping,
} from '../lib/ai/mappingPrompt'

/**
 * AI mapping suggestion («Sugerir vínculos automáticamente»). Sends the
 * UNMAPPED tag names, the column names and a few truncated sample rows to
 * OpenAI and returns a tag→column mapping (null = not confident). Without
 * OPENAI_API_KEY the fn reports `available: false` and the client falls back
 * to the name-similarity heuristic (lib/ai/suggestMapping.ts) — the button
 * never breaks because of missing config.
 */

export type AiMappingOutcome =
  | { available: false }
  | { available: true; mapping: TagMapping }

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = 'gpt-5-mini'
const TIMEOUT_MS = 15_000
/** Sanity caps: a real template has dozens of tags, not hundreds. */
const MAX_TAGS = 200
const MAX_COLUMNS = 200

export const suggestMappingFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    const tags = requireArray(i.tags, 'tags').map((t, n) => requireString(t, `tags[${n}]`))
    const columns = requireArray(i.columns, 'columns').map((c, n) =>
      requireString(c, `columns[${n}]`),
    )
    if (tags.length === 0 || tags.length > MAX_TAGS) {
      throw new ValidationError('Petición inválida: «tags» está vacío o es demasiado grande.')
    }
    if (columns.length === 0 || columns.length > MAX_COLUMNS) {
      throw new ValidationError('Petición inválida: «columns» está vacío o es demasiado grande.')
    }
    const rawRows =
      i.sampleRows === undefined || i.sampleRows === null
        ? []
        : requireArray(i.sampleRows, 'sampleRows').map((r, n) => {
            const row = requireRecord(r, `sampleRows[${n}]`)
            const out: Record<string, string> = {}
            for (const [k, v] of Object.entries(row)) out[k] = requireString(v, `sampleRows[${n}].${k}`)
            return out
          })
    // Server is the trust boundary: re-cap and re-truncate whatever arrived.
    return { tags, columns, sampleRows: sampleRowsForMapping(rawRows, columns) }
  })
  .handler(async ({ data }): Promise<Result<AiMappingOutcome>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return { ok: true, data: { available: false } }

    const { system, user: userMsg } = buildMappingMessages(data.tags, data.columns, data.sampleRows)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          reasoning_effort: 'low',
          max_completion_tokens: 4000,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMsg },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'tag_mapping',
              strict: true,
              schema: mappingSchema(data.tags, data.columns),
            },
          },
        }),
      })
      if (!res.ok) {
        return {
          ok: false,
          error: `OpenAI respondió ${res.status}.`,
          hint:
            res.status === 401
              ? 'Revisa OPENAI_API_KEY en el entorno del servidor.'
              : res.status === 429
                ? 'Límite de uso de OpenAI alcanzado; espera un momento.'
                : undefined,
        }
      }
      const body = (await res.json()) as {
        choices?: { message?: { content?: unknown } }[]
      }
      const content = body.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content === '') {
        return { ok: false, error: 'OpenAI devolvió una respuesta vacía.' }
      }
      const mapping = parseMappingContent(content, data.tags, data.columns)
      return { ok: true, data: { available: true, mapping } }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        return { ok: false, error: 'La IA tardó demasiado en responder.' }
      }
      return { ok: false, error: (err as Error)?.message || 'No se pudo contactar con OpenAI.' }
    } finally {
      clearTimeout(timer)
    }
  })
