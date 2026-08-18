import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const GUARD = fileURLToPath(new URL('../scripts/no-secrets.mjs', import.meta.url))

/** Build a throwaway package whose tarball is exactly `ship.md`, then scan it. */
function scan(shipped: string, env: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'no-secrets-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'scan-fixture', version: '0.0.0', files: ['ship.md'] }),
  )
  writeFileSync(join(dir, 'ship.md'), shipped)
  const res = spawnSync(process.execPath, [GUARD], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, ...env },
  })
  return { code: res.status, out: `${res.stdout}${res.stderr}` }
}

describe('no-secrets guard', () => {
  it('passes a clean file', () => {
    expect(scan('# hello\n\nNothing sensitive here.\n').code).toBe(0)
  }, 30_000)

  it('still catches an agent id', () => {
    const res = scan('Agent ID: `agt_zzzzsyntheticfixture01`\n')
    expect(res.code).toBe(1)
    expect(res.out).toMatch(/AgentValet agent id/)
  }, 30_000)

  it('still catches an owner id', () => {
    const res = scan('Owner ID: `00000000-0000-4000-8000-000000000000`\n')
    expect(res.code).toBe(1)
    expect(res.out).toMatch(/owner id/)
  }, 30_000)

  it('still catches private key material', () => {
    const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ\n'.repeat(4)
    const res = scan(`-----BEGIN PRIVATE KEY-----\n${body}-----END PRIVATE KEY-----\n`)
    expect(res.code).toBe(1)
    expect(res.out).toMatch(/private key material/)
  }, 30_000)

  it('still catches a vendor token', () => {
    const res = scan('export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n')
    expect(res.code).toBe(1)
    expect(res.out).toMatch(/GitHub token|secret-named variable/)
  }, 30_000)

  it('carries no hardcoded production host in the committed script', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(GUARD, 'utf8')
    // Only the excluded documentation/private ranges may appear as literals.
    const octets = source.match(/(?<![\w.])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?![\w.])/g) ?? []
    expect(octets).toEqual([])
    expect(source).not.toMatch(/mcp-\[a-z0-9\]\{20\}-supabase-co/)
  })

  it('takes specific literals from the environment instead', () => {
    const res = scan('The origin is host-nobody-should-publish.example\n', {
      NO_SECRETS_DENYLIST: 'host-nobody-should-publish.example',
    })
    expect(res.code).toBe(1)
    expect(res.out).toMatch(/local denylist/)
  }, 30_000)
})
