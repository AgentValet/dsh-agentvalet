import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentValetService } from '../../src/identity/index.js'
import { createFileCredentialStore } from '../../src/identity/store.js'

const home = () => mkdtempSync(join(tmpdir(), 'avdsh-'))

describe('agentvalet service', () => {
  it('reports not enrolled when the profile has no identity', async () => {
    const svc = await createAgentValetService({
      profile: 'web', proxyUrl: 'https://p.example',
      store: createFileCredentialStore(home()),
    })
    expect(svc.enrolled).toBe(false)
  })

  it('throws a directive error rather than returning a null client', async () => {
    const svc = await createAgentValetService({
      profile: 'web', proxyUrl: 'https://p.example',
      store: createFileCredentialStore(home()),
    })
    expect(() => svc.client()).toThrow(/not connected to agentvalet/i)
  })

  it('is enrolled after a successful bind and persists across reloads', async () => {
    const store = createFileCredentialStore(home())
    const fetchOk = (async () => new Response(
      JSON.stringify({ agent_id: 'agt_x', owner_id: 'own_y' }), { status: 200 },
    )) as any
    const svc = await createAgentValetService({
      profile: 'web', proxyUrl: 'https://p.example', store, fetch: fetchOk,
    })
    await svc.enrol('tok')
    expect(svc.enrolled).toBe(true)

    const reloaded = await createAgentValetService({
      profile: 'web', proxyUrl: 'https://p.example', store,
    })
    expect(reloaded.enrolled).toBe(true)
    expect(reloaded.client().agentId).toBe('agt_x')
  })
})
