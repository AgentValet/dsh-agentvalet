import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { chmod, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileCredentialStore, UnsafeStoreLocationError } from '../../src/identity/store.js'

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'avdsh-')) })

describe('file credential store', () => {
  it('returns null for a profile that has never enrolled', async () => {
    const store = createFileCredentialStore(home)
    expect(await store.load('web')).toBeNull()
  })

  it('round-trips an identity per profile', async () => {
    const store = createFileCredentialStore(home)
    await store.save('web', { agentId: 'a', ownerId: 'o', privateKeyPem: 'k' })
    await store.save('headless', { agentId: 'a2', ownerId: 'o', privateKeyPem: 'k2' })
    expect((await store.load('web'))?.agentId).toBe('a')
    expect((await store.load('headless'))?.agentId).toBe('a2')
  })

  it('writes the key file owner-only', async () => {
    const store = createFileCredentialStore(home)
    await store.save('web', { agentId: 'a', ownerId: 'o', privateKeyPem: 'k' })
    const mode = statSync(join(home, 'agentvalet', 'web.json')).mode & 0o777
    if (process.platform !== 'win32') expect(mode).toBe(0o600)
  })

  it('restores owner-only mode on re-bind (overwrite)', async () => {
    const store = createFileCredentialStore(home)
    const filePath = join(home, 'agentvalet', 'web.json')
    await store.save('web', { agentId: 'a', ownerId: 'o', privateKeyPem: 'k' })
    // Deliberately loosen permissions to simulate an existing file with wrong mode
    await chmod(filePath, 0o644)
    // Re-save (overwrite) and verify mode is restored
    await store.save('web', { agentId: 'a-new', ownerId: 'o', privateKeyPem: 'k-new' })
    const mode = statSync(filePath).mode & 0o777
    if (process.platform !== 'win32') expect(mode).toBe(0o600)
  })

  it('refuses to write inside a git working tree', async () => {
    // 0o600 is no defence against `git add -A`.
    mkdirSync(join(home, '.git'))
    const store = createFileCredentialStore(home)
    await expect(
      store.save('web', { agentId: 'a', ownerId: 'o', privateKeyPem: 'k' }),
    ).rejects.toBeInstanceOf(UnsafeStoreLocationError)
  })

  it('refuses when an ancestor directory is a git working tree', async () => {
    mkdirSync(join(home, '.git'))
    const nested = join(home, 'sub', 'deeper')
    mkdirSync(nested, { recursive: true })
    const store = createFileCredentialStore(nested)
    await expect(
      store.save('web', { agentId: 'a', ownerId: 'o', privateKeyPem: 'k' }),
    ).rejects.toThrow(/git working tree/i)
  })

  it('rethrows a non-ENOENT load failure instead of reporting "never enrolled"', async () => {
    const store = createFileCredentialStore(home)
    const dir = join(home, 'agentvalet')
    mkdirSync(dir, { recursive: true })
    // A truncated file: exactly what a crash mid-write used to leave behind.
    writeFileSync(join(dir, 'web.json'), '{"agentId":"a","owne')
    await expect(store.load('web')).rejects.toBeInstanceOf(SyntaxError)
  })

  it('leaves no temp file behind after a successful save', async () => {
    const store = createFileCredentialStore(home)
    await store.save('web', { agentId: 'a', ownerId: 'o', privateKeyPem: 'k' })
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(join(home, 'agentvalet'))).toEqual(['web.json'])
    expect(JSON.parse(await readFile(join(home, 'agentvalet', 'web.json'), 'utf8')).agentId).toBe('a')
  })
})
