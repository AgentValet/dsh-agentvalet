import type { Context } from '@deepseek-ai/cordis'
import * as identity from './identity/index.js'
import * as tools from './tools/index.js'

export const name = 'agentvalet'

export type Config = identity.Config | tools.Config

/**
 * `cordis.patch.yml` mounts both entries under this same package name, so THIS
 * module namespace is the plugin object Cordis registers — and Cordis reads
 * `name`/`inject` off the object it registers. Declaring `inject: []` here
 * would therefore discard `av-tools`' own `inject: ['agentvalet', 'tools']`,
 * letting the loader start the tools entry before `av-identity.apply` (which
 * is async and awaits fs I/O before `ctx.provide`) has provided the service.
 * `av-tools` would capture `ctx.agentvalet === undefined` and never reload.
 *
 * Delegating with `ctx.plugin(...)` re-registers each sub-plugin as its own
 * plugin object, so Cordis sees each one's real `name` and `inject` and defers
 * the tools fiber until the service exists, whatever order the entries mount in.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (config.plugin === 'identity') {
    await ctx.plugin(identity, config)
    return
  }
  if (config.plugin === 'tools') {
    await ctx.plugin(tools, config)
    return
  }
  throw new Error(`Unknown AgentValet plugin: ${(config as { plugin: string }).plugin}`)
}
