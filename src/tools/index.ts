import type { Context } from '@deepseek-ai/cordis'
import type { AgentValetService } from '../identity/index.js'
import { buildTools } from './define.js'

/**
 * `av-identity` registers the `agentvalet` service via `ctx.provide`, which
 * only widens the untyped service store. Declaring it here on `Context`
 * lets any plugin that injects `'agentvalet'` access `ctx.agentvalet`
 * directly instead of going through the untyped `ctx.get()` escape hatch.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    agentvalet: AgentValetService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'av-tools'

/** Hard dependencies: without either, there is nothing to register. */
export const inject = ['agentvalet', 'tools']

export interface Config {
  plugin: 'tools'
}

export async function apply(ctx: Context): Promise<void> {
  for (const tool of buildTools(ctx.agentvalet)) {
    // Retain the disposer so unload removes the registration; Cordis
    // rejects leaked contributions.
    ctx.effect(() => ctx.tools.register(tool))
  }
}
