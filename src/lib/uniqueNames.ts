export function uniqueName(used: Set<string>, base: string): string {
  let name = base
  for (let n = 2; used.has(name); n++) name = `${base} (${n})`
  used.add(name)
  return name
}
