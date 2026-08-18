import { describe, it, expect } from 'vitest'
import { bindAgent, BindError } from '../../src/identity/bind.js'

const ok = async () => new Response(
  JSON.stringify({ agent_id: 'agt_x', owner_id: 'own_y' }),
  { status: 200, headers: { 'content-type': 'application/json' } },
)

describe('bindAgent', () => {
  it('sends only the public key, never a private one', async () => {
    let sent: any
    await bindAgent({
      bootstrapToken: 'tok', publicKeyPem: '-----BEGIN PUBLIC KEY-----x',
      proxyUrl: 'https://p.example',
      fetch: (async (_u: any, init: any) => { sent = JSON.parse(init.body); return ok() }) as any,
    })
    expect(sent).toEqual({ bootstrap_token: 'tok', public_key_pem: '-----BEGIN PUBLIC KEY-----x' })
    expect(JSON.stringify(sent)).not.toContain('PRIVATE')
  })

  it('returns the agent and owner ids the client SDK needs', async () => {
    const r = await bindAgent({
      bootstrapToken: 't', publicKeyPem: 'p', proxyUrl: 'https://p.example',
      fetch: (async () => ok()) as any,
    })
    expect(r).toEqual({ agentId: 'agt_x', ownerId: 'own_y' })
  })

  it('explains a spent or expired token rather than failing generically', async () => {
    await expect(bindAgent({
      bootstrapToken: 't', publicKeyPem: 'p', proxyUrl: 'https://p.example',
      fetch: (async () => new Response(JSON.stringify({ error: 'Bootstrap token expired' }), { status: 410 })) as any,
    })).rejects.toThrow(/expired or already been used/i)
  })

  it('surfaces rate limiting distinctly', async () => {
    await expect(bindAgent({
      bootstrapToken: 't', publicKeyPem: 'p', proxyUrl: 'https://p.example',
      fetch: (async () => new Response('{}', { status: 429 })) as any,
    })).rejects.toThrow(/too many/i)
  })
})
