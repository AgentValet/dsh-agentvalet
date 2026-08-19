import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'

const raw = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

/**
 * A real `dsh` profile refuses to boot -- entirely, not just without these
 * plugins -- when this file is a mapping instead of a top-level array.
 * `parsePatchList` in @deepseek-ai/dsh-app-boot throws before any plugin
 * mounts, so getting this shape wrong breaks the user's whole harness.
 */
describe('cordis.patch.yml conforms to the loader patch dialect', () => {
  const parsed = load(raw) as unknown

  it('is a top-level array, never a mapping', () => {
    expect(Array.isArray(parsed)).toBe(true)
  })

  it('adds its rows with insert, not as id-targeted patches', () => {
    // An entry with a bare `id` PATCHES an existing row; if no row matches it
    // is warned about and skipped, so the plugins would silently never mount.
    const rows = parsed as Array<Record<string, unknown>>
    const inserted = rows.flatMap((r) => (Array.isArray(r.insert) ? r.insert : []))
    expect(inserted.length).toBeGreaterThan(0)
    for (const row of rows) {
      if (!row.insert) expect(row.id).toBeUndefined()
    }
  })

  it('mounts both entries of this bundle under this package name', () => {
    const rows = parsed as Array<Record<string, unknown>>
    const inserted = rows.flatMap((r) =>
      Array.isArray(r.insert) ? (r.insert as Array<Record<string, unknown>>) : [],
    )
    expect(inserted.map((e) => e.id)).toEqual(['av-identity', 'av-tools'])
    for (const entry of inserted) expect(entry.name).toBe('@agentvalet/dsh')
    expect(inserted.map((e) => (e.config as { plugin: string }).plugin)).toEqual([
      'identity',
      'tools',
    ])
  })
})
