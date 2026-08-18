import { describe, it, expect } from 'vitest'
import { ApprovalTimeoutError } from '@agentvalet/client'
import { validateArgs } from '@deepseek-ai/dsh-tools'
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
    // The schema enum now rejects this in dsh-tools' own validateArgs, before
    // our execute body runs — so the tool never reaches the broker at all.
    const tools = buildTools(fakeService({
      call: async () => { throw new Error('must not reach the broker') },
    }))
    const write = tools.find((t) => t.name === 'agentvalet_write_platform')!
    await expect(write.execute(
      { platform: 'slack', endpoint: '/x', scope: 'chat:write', method: 'GET' }, {} as any,
    )).rejects.toThrow(/must be one of \["POST","PUT","PATCH"\]/)
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

  it('declares the write method restriction as a schema enum', () => {
    const write = buildTools(fakeService()).find((t) => t.name === 'agentvalet_write_platform')!
    const method = (write.parameters as any).properties.method
    expect(method.enum).toEqual(['POST', 'PUT', 'PATCH'])
  })

  it('rejects a bad method upstream in validateArgs, before execute runs', () => {
    const spec = {
      platform: { type: 'string' as const, required: true as const },
      endpoint: { type: 'string' as const, required: true as const },
      scope: { type: 'string' as const, required: true as const },
      method: { type: 'string' as const, enum: ['POST', 'PUT', 'PATCH'] as const },
    }
    const args = { platform: 'slack', endpoint: '/x', scope: 'chat:write', method: 'DELETE' }
    expect(validateArgs(spec, args).length).toBeGreaterThan(0)
    expect(validateArgs(spec, { ...args, method: 'PUT' })).toEqual([])
  })

  it('returns the approval id on a timeout so the call can be resumed', async () => {
    const svc = fakeService({
      call: async () => { throw new ApprovalTimeoutError('ap_42', 5000) },
    })
    const read = buildTools(svc).find((t) => t.name === 'agentvalet_read_platform')!
    const out: any = await (read as any).execute(
      { platform: 'slack', endpoint: '/x', scope: 'chat:write' }, {} as any,
    )
    expect(out.ok).toBe(false)
    expect(out.approvalId).toBe('ap_42')
  })
})
