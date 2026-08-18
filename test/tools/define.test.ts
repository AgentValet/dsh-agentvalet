import { describe, it, expect } from 'vitest'
import { buildTools } from '../../src/tools/define.js'

function fakeService(over: Partial<any> = {}) {
  return {
    enrolled: true,
    client: () => ({
      listPlatforms: async () => ({ platforms: [] }),
      call: async (req: any) => ({ echo: req }),
      ...over,
    }),
    enrol: async () => {},
  } as any
}

describe('platform tools', () => {
  it('registers exactly the four governed tools', () => {
    const names = buildTools(fakeService()).map((t) => t.name)
    expect(names).toEqual([
      'agentvalet_list_platforms',
      'agentvalet_read_platform',
      'agentvalet_write_platform',
      'agentvalet_delete_platform',
    ])
  })

  it('read_platform issues a GET', async () => {
    const tools = buildTools(fakeService())
    const read = tools.find((t) => t.name === 'agentvalet_read_platform')!
    const out: any = await read.execute(
      { platform: 'github', endpoint: '/user', scope: 'read' }, {} as any,
    )
    expect(out.ok).toBe(true)
    expect(out.data.echo.method).toBe('GET')
  })

  it('delete_platform issues a DELETE', async () => {
    const tools = buildTools(fakeService())
    const del = tools.find((t) => t.name === 'agentvalet_delete_platform')!
    const out: any = await del.execute(
      { platform: 'linear', endpoint: '/issues/1', scope: 'write' }, {} as any,
    )
    expect(out.ok).toBe(true)
    expect(out.data.echo.method).toBe('DELETE')
  })

  it('rejects a non-mutating method on write_platform before any network call', async () => {
    const tools = buildTools(fakeService({
      call: async () => { throw new Error('must not reach the broker') },
    }))
    const write = tools.find((t) => t.name === 'agentvalet_write_platform')!
    const out: any = await write.execute(
      { platform: 'slack', endpoint: '/x', scope: 'chat:write', method: 'GET' }, {} as any,
    )
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/POST, PUT or PATCH/i)
  })

  it('returns a governed failure rather than throwing out of the tool', async () => {
    const tools = buildTools(fakeService({
      call: async () => { throw new Error('boom') },
    }))
    const read = tools.find((t) => t.name === 'agentvalet_read_platform')!
    const out: any = await read.execute(
      { platform: 'github', endpoint: '/user', scope: 'read' }, {} as any,
    )
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/did not complete/i)
  })
})
