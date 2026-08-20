import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

describe('shipped AGENTS.md', () => {
  it('tells the agent to route platform calls through AgentValet', () => {
    expect(doc).toMatch(/agentvalet_list_platforms/)
    expect(doc).toMatch(/route/i)
  })
  it('carries no agent id', () => {
    expect(doc).not.toMatch(/agt_[a-z0-9]{10,}/)
  })
  it('makes no delegation or attenuation claim', () => {
    expect(doc).not.toMatch(/delegat|attenuat/i)
  })
})

describe('shipped README.md', () => {
  it('states plainly that delegation and attenuation are not implemented', () => {
    // The words may appear, but only inside the sentence that denies them.
    for (const line of readme.split(/\r?\n/)) {
      if (!/delegat|attenuat/i.test(line)) continue
      expect(line).toMatch(/does not|neither|no sub-agent|implements neither/i)
    }
    expect(readme).toMatch(/implements neither/i)
    // No hedged "guarantee" phrasing, which implies the feature exists.
    expect(readme).not.toMatch(/(delegation|attenuation)[^.\n]*guarantee/i)
  })
  it('carries no agent id', () => {
    expect(readme).not.toMatch(/agt_[a-z0-9]{10,}/)
  })
})

/**
 * The shipped file is documentation; `src/identity/instructions.ts` is what the
 * model actually receives. They must not drift into saying different things.
 */
describe('shipped AGENTS.md agrees with the block connect writes', () => {
  it('names the same four tools', async () => {
    const { ROUTING_BLOCK } = await import('../src/identity/instructions.js')
    for (const tool of [
      'agentvalet_list_platforms',
      'agentvalet_read_platform',
      'agentvalet_write_platform',
      'agentvalet_delete_platform',
    ]) {
      expect(doc).toContain(tool)
      expect(ROUTING_BLOCK).toContain(tool)
    }
  })

  it('says plainly that this copy is not the one dsh loads', () => {
    expect(doc).toMatch(/NOT loaded by dsh/i)
    expect(doc).toMatch(/\$DSH_HOME\/AGENTS\.md/)
  })
})
