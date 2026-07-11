/**
 * Disambiguate a name against a set of already-used ones: "Nombre" stays
 * "Nombre", the next one becomes "Nombre (2)", then "Nombre (3)"…
 * Used for duplicate spreadsheet column headers, where a plain object key
 * would silently overwrite the earlier column's values.
 * Mutates `used` by adding the returned name.
 */
export function uniqueName(used: Set<string>, base: string): string {
  let name = base
  for (let n = 2; used.has(name); n++) name = `${base} (${n})`
  used.add(name)
  return name
}
