
import type { ApiSourceConfig } from '../types'

export class ValidationError extends Error {}

export function requireRecord(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ValidationError(`Petición inválida: falta «${what}».`)
  }
  return v as Record<string, unknown>
}

export function requireString(v: unknown, what: string): string {
  if (typeof v !== 'string') {
    throw new ValidationError(`Petición inválida: «${what}» debe ser un texto.`)
  }
  return v
}

export function optionalString(v: unknown, what: string): string | undefined {
  if (v === undefined || v === null) return undefined
  return requireString(v, what)
}

export function requireInt(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new ValidationError(`Petición inválida: «${what}» debe ser un número entero.`)
  }
  return v
}

export function requireUuid(v: unknown, what: string): string {
  const id = requireString(v, what)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ValidationError(`Petición inválida: «${what}» no es un identificador válido.`)
  }
  return id
}

export function requireArray(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new ValidationError(`Petición inválida: «${what}» debe ser una lista.`)
  }
  return v
}

export function requireOneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ValidationError(`Petición inválida: «${what}» no es un valor permitido.`)
  }
  return v as T
}

export function requirePdfJobs(v: unknown): { name: string; html: string }[] {
  return requireArray(v, 'jobs').map((j, i) => {
    const job = requireRecord(j, `jobs[${i}]`)
    return {
      name: requireString(job.name, `jobs[${i}].name`),
      html: requireString(job.html, `jobs[${i}].html`),
    }
  })
}

export function optionalFormats(v: unknown): ('pdf' | 'docx')[] | undefined {
  if (v === undefined || v === null) return undefined
  return requireArray(v, 'formats').map((f) => requireOneOf(f, ['pdf', 'docx'], 'formats'))
}

export function optionalApiConfig(v: unknown): ApiSourceConfig | undefined {
  if (v === undefined || v === null) return undefined
  const r = requireRecord(v, 'apiConfig')
  return {
    authUrl: requireString(r.authUrl, 'apiConfig.authUrl'),
    authBody: requireString(r.authBody, 'apiConfig.authBody'),
    tokenPath: requireString(r.tokenPath, 'apiConfig.tokenPath'),
    dataUrl: requireString(r.dataUrl, 'apiConfig.dataUrl'),
    recordsPath: requireString(r.recordsPath, 'apiConfig.recordsPath'),
    columns: requireArray(r.columns, 'apiConfig.columns').map((c, i) =>
      requireString(c, `apiConfig.columns[${i}]`),
    ),
  }
}
