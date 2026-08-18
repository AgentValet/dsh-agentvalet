import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as bundle from '../../src/index.js'

const EXPECTED = [
  'agentvalet_list_platforms',
  'agentvalet_read_platform',
  'agentvalet_write_platform',
  'agentvalet_delete_platform',
]

/**
 * `cordis.patch.yml` mounts both entries under the same package name, and the
 * loader may start them in either order. The ordering here is the whole point:
 * if the entry discarded the sub-plugins' `inject` metadata, the tools fiber
 * would run before `av-identity` provided the service and register nothing.
 */
describe('bundle entry mounted tools-first', () => {
  it('registers all four tools even when the tools entry mounts first', async () => {
    const home = mkdtempSync(join(tmpdir(), 'avdsh-entry-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})

    // Tools BEFORE identity, deliberately.
    const toolsFiber = ctx.plugin(bundle, { plugin: 'tools' })
    await ctx.plugin(bundle, { plugin: 'identity', homeDir: home, profile: 'web' })
    await toolsFiber

    // The tools fiber is deferred until `agentvalet` exists, so give the
    // registry a turn to settle after the service appears.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const names = ctx.tools.schemas().map((s) => s.name)
    for (const expected of EXPECTED) expect(names).toContain(expected)
  })
})
