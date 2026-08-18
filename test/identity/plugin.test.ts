import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ConfigError } from '@agentvalet/client'
import { createAgentValetService, defaultHomeDir } from '../../src/identity/index.js'
import { toToolFailure } from '../../src/tools/errors.js'
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

  it('throws a ConfigError the tool layer can map, not a bare Error', async () => {
    const svc = await createAgentValetService({
      profile: 'web', proxyUrl: 'https://p.example',
      store: createFileCredentialStore(home()),
    })
    expect(() => svc.client()).toThrow(/not connected to agentvalet/i)
    let thrown: unknown
    try { svc.client() } catch (err) { thrown = err }
    expect(thrown).toBeInstanceOf(ConfigError)
    // The whole point: the not-enrolled path must render the actionable
    // connect sentence, not the generic "unexpected reason" fallback.
    expect(toToolFailure(thrown)).toMatch(/Connect this dsh profile to AgentValet with a bootstrap token/)
  })

  describe('defaultHomeDir', () => {
    it('never falls back to the working directory', () => {
      expect(defaultHomeDir({} as NodeJS.ProcessEnv)).toBe(join(homedir(), '.dsh'))
      expect(defaultHomeDir({} as NodeJS.ProcessEnv)).not.toBe(process.cwd())
    })
    it('honours DSH_HOME when set', () => {
      expect(defaultHomeDir({ DSH_HOME: '/somewhere' } as NodeJS.ProcessEnv)).toBe('/somewhere')
    })
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

  it('refuses to replace an existing identity and does not clobber the store', async () => {
    const store = createFileCredentialStore(home())
    const fetchOk = (async () => new Response(
      JSON.stringify({ agent_id: 'agt_x', owner_id: 'own_y' }), { status: 200 },
    )) as any
    const svc = await createAgentValetService({
      profile: 'web', proxyUrl: 'https://p.example', store, fetch: fetchOk,
    })
    await svc.enrol('tok')

    await expect(svc.enrol('tok2')).rejects.toThrow(/already connected/i)
    expect(svc.client().agentId).toBe('agt_x')
  })
})
