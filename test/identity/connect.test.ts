import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseConnectArgs, runConnect, CONNECT_USAGE } from '../../src/identity/connect.js'
import * as tools from '../../src/tools/index.js'
import { buildTools } from '../../src/tools/define.js'

const home = () => mkdtempSync(join(tmpdir(), 'avdsh-connect-'))
const TOKEN = 'bt_supersecret_bootstrap_value' // no-secrets-fixture: synthetic, proves the guard fires
const okFetch = (async () =>
  new Response(JSON.stringify({ agent_id: 'agt_x', owner_id: 'own_y' }), {
    status: 200,
  })) as typeof globalThis.fetch

describe('parseConnectArgs', () => {
  it('reads both --flag value and --flag=value', () => {
    expect(parseConnectArgs(['--profile', 'web', '--token=abc'])).toEqual({
      profile: 'web', token: 'abc',
    })
  })
  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseConnectArgs(['--nope', 'x'])).toThrow(/Unrecognised argument/)
  })
  it('rejects a flag with no value', () => {
    expect(() => parseConnectArgs(['--token'])).toThrow(/needs a value/)
  })
  it('returns help for --help', () => {
    expect(parseConnectArgs(['--help'])).toEqual({ help: true })
  })

  it('never echoes the value of a mistyped --flag=value argument', () => {
    const secret = 'bt_SECRET_VALUE_123'
    let thrown: unknown
    try {
      parseConnectArgs([`--tokn=${secret}`])
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    expect(message).not.toContain(secret)
    expect(message).toContain('--tokn')
  })

  it('never echoes a bare positional argument (which IS the token)', () => {
    const secret = 'bt_SECRET_POSITIONAL' // no-secrets-fixture: synthetic, proves the CLI never echoes it
    let thrown: unknown
    try {
      parseConnectArgs([secret])
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    expect(message).not.toContain(secret)
    expect(message).toMatch(/--token/)
  })
})

describe('runConnect', () => {
  it('prints usage for --help', async () => {
    expect(await runConnect({ argv: ['--help'], env: {} })).toBe(CONNECT_USAGE)
  })

  it('refuses without a token and says where to get one', async () => {
    await expect(runConnect({ argv: ['--home', home()], env: {} })).rejects.toThrow(
      /No bootstrap token.*app\.agentvalet\.ai/s,
    )
  })

  it('enrols the profile and never echoes the token or the key', async () => {
    const dir = home()
    const out = await runConnect({
      argv: ['--profile', 'web', '--token', TOKEN, '--home', dir, '--proxy', 'https://p.example'],
      env: {},
      fetch: okFetch,
    })
    expect(out).toContain('agt_x')
    expect(out).not.toContain(TOKEN)
    const stored = JSON.parse(await readFile(join(dir, 'agentvalet', 'web.json'), 'utf8'))
    expect(stored.agentId).toBe('agt_x')
    expect(out).not.toContain(stored.privateKeyPem)
    expect(out).not.toContain('PRIVATE KEY')
  })

  it('reads the token from AGENTVALET_BOOTSTRAP_TOKEN', async () => {
    const out = await runConnect({
      argv: ['--home', home(), '--proxy', 'https://p.example'],
      env: { AGENTVALET_BOOTSTRAP_TOKEN: TOKEN } as NodeJS.ProcessEnv,
      fetch: okFetch,
    })
    expect(out).toContain('agt_x')
    expect(out).not.toContain(TOKEN)
  })

  it('refuses to re-connect an already-connected profile', async () => {
    const dir = home()
    const argv = ['--profile', 'web', '--token', TOKEN, '--home', dir, '--proxy', 'https://p.example']
    await runConnect({ argv, env: {}, fetch: okFetch })
    await expect(runConnect({ argv, env: {}, fetch: okFetch })).rejects.toThrow(/already connected/i)
  })
})

describe('enrolment is not model-facing', () => {
  // Governance, not UX: a tool the model can call would let an agent bootstrap
  // its own identity with no human in the loop.
  it('registers no tool that can enrol', () => {
    const svc = { enrolled: false, client: () => { throw new Error('x') }, enrol: async () => {} }
    const names = buildTools(svc).map((t) => t.name)
    expect(names.some((n) => /connect|enrol|enroll|bind|bootstrap/i.test(n))).toBe(false)
    expect(names).toHaveLength(4)
  })
  it('the tools entry exports no enrol surface', () => {
    expect(Object.keys(tools)).not.toContain('enrol')
  })
})
