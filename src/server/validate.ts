/**
 * Tiny runtime validators for server-function inputs. Server functions are
 * HTTP endpoints: the TypeScript types on `.validator()` say nothing about
 * what actually arrives, and an identity validator lets a malformed payload
 * explode inside the handler. These keep the checks one line per field.
 */

/** Thrown on malformed input; the transport surfaces it as a request error. */
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

/** UUID shape — a malformed id is a bad request, not a DB round-trip. */
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

/** A value out of a fixed set of literals (e.g. a union of string kinds). */
export function requireOneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ValidationError(`Petición inválida: «${what}» no es un valor permitido.`)
  }
  return v as T
}

/** The `jobs` payload shared by the HTML-based generation endpoints. */
export function requirePdfJobs(v: unknown): { name: string; html: string }[] {
  return requireArray(v, 'jobs').map((j, i) => {
    const job = requireRecord(j, `jobs[${i}]`)
    return {
      name: requireString(job.name, `jobs[${i}].name`),
      html: requireString(job.html, `jobs[${i}].html`),
    }
  })
}

/** Optional output-format list for the Google generation endpoints. */
export function optionalFormats(v: unknown): ('pdf' | 'docx')[] | undefined {
  if (v === undefined || v === null) return undefined
  return requireArray(v, 'formats').map((f) => requireOneOf(f, ['pdf', 'docx'], 'formats'))
}
