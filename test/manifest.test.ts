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
  it('has no default export path and ships types', () => {
    expect(pkg.exports['.'].types).toBe('./lib/types/index.d.ts')
  })
  it('runs the secrets gate before publish', () => {
    expect(pkg.scripts.prepublishOnly).toContain('no-secrets.mjs')
  })
})
