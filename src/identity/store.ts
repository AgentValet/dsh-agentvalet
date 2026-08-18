import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface StoredIdentity {
  agentId: string
  ownerId: string
  privateKeyPem: string
}

/**
 * Seam. The file implementation is the fallback; if the harness exposes a
 * credential service, a second implementation swaps in behind this interface
 * without touching callers.
 */
export interface CredentialStore {
  load(profile: string): Promise<StoredIdentity | null>
  save(profile: string, identity: StoredIdentity): Promise<void>
}

export function createFileCredentialStore(homeDir: string): CredentialStore {
  const dir = join(homeDir, 'agentvalet')
  const pathFor = (profile: string) => join(dir, `${profile}.json`)

  return {
    async load(profile) {
      try {
        return JSON.parse(await readFile(pathFor(profile), 'utf8')) as StoredIdentity
      } catch {
        return null
      }
    },
    async save(profile, identity) {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await writeFile(pathFor(profile), JSON.stringify(identity), { mode: 0o600 })
    },
  }
}
