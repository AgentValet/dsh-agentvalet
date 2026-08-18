import { describe, it, expect } from 'vitest'
import pkg from '../package.json' with { type: 'json' }

describe('bundle manifest', () => {
  it('declares the dsh bundle patch', () => {
    expect(pkg.dsh?.bundle?.patch).toBe('cordis.patch.yml')
  })
  it('pins the verified peer ranges', () => {
    expect(pkg.peerDependencies['@deepseek-ai/cordis']).toBe('^4.0.1')
    expect(pkg.peerDependencies['@deepseek-ai/dsh-tools']).toBe('^0.1.0-rc.7')
  })
  it('ships types and exports only the entry and package.json', () => {
    expect(pkg.exports['.'].types).toBe('./lib/types/index.d.ts')
    expect(pkg.exports['.'].default).toBe('./lib/index.js')
    // "exports" is a closed map: no deep import path exists beyond these two,
    // so lib/identity/* and lib/tools/* are not part of the public API.
    expect(Object.keys(pkg.exports)).toEqual(['.', './package.json'])
  })

  it('ships the connect bin it documents', () => {
    expect(pkg.bin['agentvalet-dsh-connect']).toBe('./bin/connect.mjs')
    expect(pkg.files).toContain('bin/connect.mjs')
    expect(pkg.files).toContain('LICENSE')
  })
  it('runs the secrets gate before publish', () => {
    expect(pkg.scripts.prepublishOnly).toContain('no-secrets.mjs')
  })
})
