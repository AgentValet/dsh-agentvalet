import type { Context } from '@deepseek-ai/cordis'
import * as identity from './identity/index.js'
import * as tools from './tools/index.js'

export const name = 'agentvalet'
export const inject: string[] = []

export type Config = identity.Config | tools.Config

export async function apply(ctx: Context, config: Config): Promise<void> {
  if (config.plugin === 'identity') return identity.apply(ctx, config)
  if (config.plugin === 'tools') return tools.apply(ctx)
  throw new Error(`Unknown AgentValet plugin: ${(config as { plugin: string }).plugin}`)
}
