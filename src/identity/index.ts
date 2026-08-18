import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentValet, ConfigError } from '@agentvalet/client'
import type { Context } from '@deepseek-ai/cordis'
import { generateAgentKeypair } from './keypair.js'
import { bindAgent } from './bind.js'
import { createFileCredentialStore, type CredentialStore, type StoredIdentity } from './store.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'av-identity'

/** No hard dependencies: identity must boot before anything injects it. */
export const inject: string[] = []

const DEFAULT_PROXY_URL = 'https://api.agentvalet.ai'

/**
 * Where the profile's signing key lives when nothing else says otherwise.
 *
 * NEVER `process.cwd()`. For an interactive dsh session the cwd is the user's
 * project repository, so a default there puts an RS256 private key one
 * `git add -A` away from being committed and pushed.
 */
export function defaultHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.DSH_HOME ?? join(homedir(), '.dsh')
}

export interface AgentValetService {
  readonly enrolled: boolean
  client(): AgentValet
  enrol(bootstrapToken: string): Promise<void>
}

export interface ServiceOptions {
  profile: string
  proxyUrl: string
  store: CredentialStore
  fetch?: typeof globalThis.fetch
}

export async function createAgentValetService(opts: ServiceOptions): Promise<AgentValetService> {
  let identity: StoredIdentity | null = await opts.store.load(opts.profile)

  const build = (id: StoredIdentity) => new AgentValet({
    agentId: id.agentId,
    ownerId: id.ownerId,
    privateKey: id.privateKeyPem,
    proxyUrl: opts.proxyUrl,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  })

  return {
    get enrolled() { return identity !== null },

    client() {
      if (!identity) {
        // ConfigError, not a plain Error: `src/tools/errors.ts` maps the
        // AgentValet error classes to the sentence the model sees, and a plain
        // Error falls through to the useless generic fallback.
        throw new ConfigError(
          'This dsh profile is not connected to AgentValet. Run `agentvalet-dsh-connect` with a bootstrap token from https://app.agentvalet.ai.',
        )
      }
      return build(identity)
    },

    async enrol(bootstrapToken: string) {
      // Never silently replace an existing identity: that would launder one
      // agent's audit history into another's.
      if (identity) throw new Error('This profile is already connected to AgentValet.')

      // Fail before the single-use bootstrap token is spent: bindAgent below
      // consumes it and creates the agent server-side, so if the destination
      // can never be saved to, we must find out now, not after the token is
      // gone. `store.save` performs the same check again — that second check
      // is the real guarantee, since the destination could change between
      // this call and the save below — but this one protects the token.
      await opts.store.assertWritable(opts.profile)

      const { publicKeyPem, privateKeyPem } = await generateAgentKeypair()
      const bound = await bindAgent({
        bootstrapToken, publicKeyPem, proxyUrl: opts.proxyUrl,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      })
      const next: StoredIdentity = { ...bound, privateKeyPem }
      await opts.store.save(opts.profile, next)
      identity = next
    },
  }
}

export interface Config {
  plugin: 'identity'
  profile?: string
  proxyUrl?: string
  homeDir?: string
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const service = await createAgentValetService({
    profile: config.profile ?? 'default',
    proxyUrl: config.proxyUrl ?? DEFAULT_PROXY_URL,
    store: createFileCredentialStore(config.homeDir ?? defaultHomeDir()),
  })
  // `ctx.set` only overwrites a service that is already provided in this
  // fiber; registering a brand-new service name requires `ctx.provide`
  // (see node_modules/@deepseek-ai/cordis/lib/types/reflect.d.ts).
  ctx.provide('agentvalet', service)
}
