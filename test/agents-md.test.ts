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
