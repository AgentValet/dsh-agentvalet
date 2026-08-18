import { describe, it, expect } from 'vitest'
import { generateAgentKeypair } from '../../src/identity/keypair.js'

describe('generateAgentKeypair', () => {
  it('emits an SPKI public PEM the proxy will accept', async () => {
    const { publicKeyPem } = await generateAgentKeypair()
    expect(publicKeyPem).toContain('BEGIN PUBLIC KEY')
    expect(publicKeyPem).toContain('END PUBLIC KEY')
  })

  it('emits a PKCS#8 private PEM', async () => {
    const { privateKeyPem } = await generateAgentKeypair()
    expect(privateKeyPem).toContain('BEGIN PRIVATE KEY')
  })

  it('produces a distinct pair each call', async () => {
    const a = await generateAgentKeypair()
    const b = await generateAgentKeypair()
    expect(a.privateKeyPem).not.toBe(b.privateKeyPem)
  })
})
