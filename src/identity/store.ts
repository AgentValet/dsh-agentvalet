import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

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

/** Raised when the store refuses to write the private key where it is. */
export class UnsafeStoreLocationError extends Error {}

function isErrnoCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code
}

/**
 * Walk from `dir` to the filesystem root looking for a `.git` entry. A private
 * key inside a working tree is one `git add -A` away from being published, and
 * file mode 0o600 is no defence against that.
 */
async function findGitRoot(dir: string): Promise<string | null> {
  let current = dir
  for (;;) {
    try {
      await stat(join(current, '.git'))
      return current
    } catch (err) {
      if (!isErrnoCode(err, 'ENOENT') && !isErrnoCode(err, 'ENOTDIR')) throw err
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function createFileCredentialStore(homeDir: string): CredentialStore {
  const dir = join(homeDir, 'agentvalet')
  const pathFor = (profile: string) => join(dir, `${profile}.json`)

  return {
    async load(profile) {
      try {
        return JSON.parse(await readFile(pathFor(profile), 'utf8')) as StoredIdentity
      } catch (err) {
        // ONLY "no such file" means "never enrolled". Reporting a truncated
        // file, EACCES or EBUSY as "not connected" would let enrol() decide the
        // profile is fresh and overwrite a live identity with a new agent id —
        // exactly the audit-history laundering the enrol() guard exists to stop.
        if (isErrnoCode(err, 'ENOENT')) return null
        throw err
      }
    },
    async save(profile, identity) {
      const gitRoot = await findGitRoot(dir)
      if (gitRoot !== null) {
        throw new UnsafeStoreLocationError(
          `Refusing to write the AgentValet private key to ${dir}: it is inside the git working tree at ${gitRoot}. ` +
            'Set DSH_HOME (or the plugin\'s homeDir) to a location outside any repository.',
        )
      }
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const path = pathFor(profile)
      // Temp file + rename: writeFile truncates in place, so a crash mid-write
      // leaves a half-written identity that no longer parses.
      const tmp = `${path}.${process.pid}.tmp`
      try {
        await writeFile(tmp, JSON.stringify(identity), { mode: 0o600 })
        // writeFile mode only applies on creation. Force 0o600 on both create and overwrite.
        await chmod(tmp, 0o600)
        await rename(tmp, path)
        await chmod(path, 0o600)
      } catch (err) {
        await unlink(tmp).catch(() => {})
        throw err
      }
    },
  }
}
