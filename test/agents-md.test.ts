import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8')

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
