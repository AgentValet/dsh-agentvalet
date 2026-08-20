import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeRoutingInstructions,
  ROUTING_BLOCK,
  BLOCK_START,
  BLOCK_END,
} from '../../src/identity/instructions.js'

const home = () => mkdtempSync(join(tmpdir(), 'avdsh-instr-'))

describe('routing instructions', () => {
  it('creates $DSH_HOME/AGENTS.md when there is none', async () => {
    const dir = home()
    const outcome = await writeRoutingInstructions(dir)
    expect(outcome.kind).toBe('created')
    const written = await readFile(join(dir, 'AGENTS.md'), 'utf8')
    expect(written).toContain('agentvalet_list_platforms')
    expect(written).toContain(BLOCK_START)
    expect(written).toContain(BLOCK_END)
  })

  it("never destroys a user's existing instructions", async () => {
    const dir = home()
    const mine = '# My rules\n\nAlways run the tests before saying you are done.\n'
    writeFileSync(join(dir, 'AGENTS.md'), mine)

    await writeRoutingInstructions(dir)
    const written = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(written).toContain('Always run the tests before saying you are done.')
    expect(written).toContain('agentvalet_list_platforms')
    expect(written.indexOf(mine.trim())).toBeLessThan(written.indexOf(BLOCK_START))
  })

  it('replaces the managed block instead of appending a second one', async () => {
    const dir = home()
    await writeRoutingInstructions(dir)
    const second = await writeRoutingInstructions(dir)
    expect(second.kind).toBe('unchanged')

    const written = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(written.split(BLOCK_START).length - 1).toBe(1)
    expect(written.split(BLOCK_END).length - 1).toBe(1)
  })

  it('refreshes a stale block in place, keeping surrounding content', async () => {
    const dir = home()
    writeFileSync(
      join(dir, 'AGENTS.md'),
      `# Mine\n\n${BLOCK_START}\nold and wrong\n${BLOCK_END}\n\n# Also mine\n`,
    )
    const outcome = await writeRoutingInstructions(dir)
    expect(outcome.kind).toBe('updated')

    const written = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(written).not.toContain('old and wrong')
    expect(written).toContain('# Mine')
    expect(written).toContain('# Also mine')
    expect(written).toContain('agentvalet_read_platform')
  })

  it('carries no identity: this file gets copied and pasted around', () => {
    expect(ROUTING_BLOCK).not.toMatch(/agt_[a-z0-9]{10,}/)
    expect(ROUTING_BLOCK).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/)
    // Scope lists go stale and are per-agent; the tool call is the source of truth.
    expect(ROUTING_BLOCK).toContain('verbatim as returned by')
  })

  it('makes no delegation or attenuation claim', () => {
    expect(ROUTING_BLOCK).not.toMatch(/delegat|attenuat/i)
  })

  it('reports failure rather than throwing, because the token is already spent', async () => {
    // A path that cannot be a directory: its parent is a regular file.
    const dir = home()
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'not a directory')
    const outcome = await writeRoutingInstructions(join(blocker, 'nested'))
    expect(outcome.kind).toBe('failed')
  })
})
