import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as bundle from '../../src/index.js'

/**
 * End-to-end against the real harness runtime and a real HTTP proxy.
 *
 * Every other test in this repo stubs `fetch` or drives a function directly.
 * This one drives `ctx.tools.execute(...)` -- the same entry point the agent
 * loop uses, through `tools/pre-execute` -> dispatch -> `tools/post-execute` --
 * on an unmodified `@deepseek-ai/cordis` Context and `ToolRuntime`, and lets
 * the real `@agentvalet/client` speak real HTTP to a local server.
 *
 * What it is not: the `dsh` CLI, its web UI, or an LLM. Those wrap a model loop
 * around this pipeline; they do not replace it.
 */

interface Recorded {
  path: string
  auth: string | undefined
  body: string
}

let server: Server
let base: string
const seen: Recorded[] = []

/** The fake proxy. Behaviour is selected by the `platform` in the action body. */
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      seen.push({ path: req.url ?? '', auth: req.headers.authorization, body })
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }

      if (req.url === '/v1/agents/bind') {
        return json(200, { agent_id: 'agt_e2efake0000000000001', owner_id: randomUUID() })
      }
      if (req.url === '/v1/agent/permissions') {
        return json(200, { platforms: [{ platformId: 'github', scopes: ['contents.read'] }] })
      }
      if (req.url === '/v1/actions') {
        const platform = (JSON.parse(body || '{}') as { platform?: string }).platform
        if (platform === 'denied') {
          return json(403, { error: 'not_granted', platform: 'denied', scope: 'x:y' })
        }
        if (platform === 'suspended') {
          // The real proxy sends { reason: 'agent_suspended' }; src/tools/errors.ts
          // parses exactly that, so the fake must not invent a friendlier shape.
          return json(403, { reason: 'agent_suspended' })
        }
        return json(200, { ok: true, login: 'octocat' })
      }
      return json(404, { error: 'not_found' })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

/** Boot a real Context with the real tool runtime and this bundle mounted on it. */
async function boot(homeDir: string, proxyUrl: string) {
  const ctx = new Context()
  // ToolRuntime injects the system-prompt service; without it the tools fiber
  // defers forever and ctx.tools is never provided.
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(bundle, { plugin: 'identity', homeDir, profile: 'web', proxyUrl })
  await ctx.plugin(bundle, { plugin: 'tools' })
  // The tools fiber is deferred until `agentvalet` exists; give it a turn.
  await new Promise((resolve) => setTimeout(resolve, 50))
  return ctx
}

const home = () => mkdtempSync(join(tmpdir(), 'avdsh-e2e-'))

/**
 * Run a tool the way the agent loop does. The runtime hands back rendered
 * content blocks, so the tool's own JSON outcome is recovered from the text.
 */
async function call(ctx: Context, name: string, args: unknown) {
  const result = await ctx.tools.execute({
    callId: randomUUID(),
    name,
    arguments: args,
    signal: new AbortController().signal,
  } as never)
  const text = JSON.stringify(result)
  return { raw: result, text }
}

/** Pull the tool's `{ ok, ... }` payload back out of the rendered blocks. */
function outcomeOf(text: string): { ok: boolean; error?: string; data?: Record<string, unknown> } {
  const unescaped = text.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  const start = unescaped.indexOf('{"ok":')
  if (start === -1) throw new Error(`no tool outcome in: ${text.slice(0, 400)}`)
  let depth = 0
  for (let i = start; i < unescaped.length; i++) {
    if (unescaped[i] === '{') depth++
    else if (unescaped[i] === '}') {
      depth--
      if (depth === 0) return JSON.parse(unescaped.slice(start, i + 1))
    }
  }
  throw new Error(`unterminated tool outcome in: ${text.slice(0, 400)}`)
}

describe('end-to-end on the real harness runtime', () => {
  it('exposes exactly the four tools to the model', async () => {
    const ctx = await boot(home(), base)
    expect(ctx.tools.schemas().map((s) => s.name)).toEqual([
      'agentvalet_list_platforms',
      'agentvalet_read_platform',
      'agentvalet_write_platform',
      'agentvalet_delete_platform',
    ])
  })

  it('fails closed with the connect instruction when the profile is not enrolled', async () => {
    const ctx = await boot(home(), base)
    const { text } = await call(ctx, 'agentvalet_list_platforms', {})
    expect(text).toMatch(/Connect this dsh profile to AgentValet/)
    expect(text).not.toMatch(/octocat/)
  })

  it('enrols over real HTTP, keeps the private key off the wire, and then works', async () => {
    const dir = home()
    const ctx = await boot(dir, base)
    seen.length = 0
    await ctx.agentvalet.enrol('bt_e2e_fixture_token') // no-secrets-fixture: synthetic bootstrap token
    expect(ctx.agentvalet.enrolled).toBe(true)

    const bind = seen.find((r) => r.path === '/v1/agents/bind')
    expect(bind).toBeDefined()
    expect(bind!.body).toMatch(/PUBLIC KEY/)
    expect(bind!.body).not.toMatch(/PRIVATE KEY/)

    // The signing key is on disk, and only on disk.
    const stored = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => readFileSync(join(e.parentPath ?? dir, e.name), 'utf8'))
      .join('')
    expect(stored).toMatch(/PRIVATE KEY/)

    const { text } = await call(ctx, 'agentvalet_read_platform', {
      platform: 'github',
      endpoint: '/user',
      scope: 'contents.read',
    })
    const outcome = outcomeOf(text)
    expect(outcome.ok).toBe(true)
    expect(outcome.data!.login).toBe('octocat')

    // Every call carries a freshly minted assertion; nothing is pinned.
    const actions = seen.filter((r) => r.path === '/v1/actions')
    expect(actions.length).toBeGreaterThan(0)
    for (const action of actions) expect(action.auth).toMatch(/^Bearer ey/)
  })

  it('turns not_granted into an owner-facing instruction, not a raw 403', async () => {
    const ctx = await boot(home(), base)
    await ctx.agentvalet.enrol('bt_e2e_fixture_token') // no-secrets-fixture: synthetic bootstrap token
    const { text } = await call(ctx, 'agentvalet_read_platform', {
      platform: 'denied',
      endpoint: '/x',
      scope: 'x:y',
    })
    const outcome = outcomeOf(text)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toMatch(/grant|approve|owner/i)
  })

  it("names the suspension as the owner decision, not the circuit breaker", async () => {
    const ctx = await boot(home(), base)
    await ctx.agentvalet.enrol('bt_e2e_fixture_token') // no-secrets-fixture: synthetic bootstrap token
    const { text } = await call(ctx, 'agentvalet_read_platform', {
      platform: 'suspended',
      endpoint: '/x',
      scope: 'x:y',
    })
    const outcome = outcomeOf(text)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toMatch(/suspended by its owner/i)
    // The breaker is a different failure with different advice; conflating them
    // tells a user to wait for a reset that is never coming.
    expect(outcome.error).not.toMatch(/breaker|retry in|wait a few minutes/i)
    expect(outcome.error).toMatch(/Nothing was sent to the platform/)
  })

  it('fails closed, never open, when the proxy is unreachable', async () => {
    const dir = home()
    const live = await boot(dir, base)
    await live.agentvalet.enrol('bt_e2e_fixture_token') // no-secrets-fixture: synthetic bootstrap token

    // Same enrolled identity, dead proxy: port 9 (discard) accepts nothing.
    const dead = await boot(dir, 'http://127.0.0.1:9')
    const { text } = await call(dead, 'agentvalet_read_platform', {
      platform: 'github',
      endpoint: '/user',
      scope: 'contents.read',
    })
    const outcome = outcomeOf(text)
    expect(outcome.ok).toBe(false)
    expect(outcome.error!.length).toBeGreaterThan(0)
    expect(text).not.toMatch(/octocat/)
  })
})
