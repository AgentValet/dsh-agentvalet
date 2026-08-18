import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, statSync } from 'node:fs'
import { chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileCredentialStore } from '../../src/identity/store.js'

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
})
