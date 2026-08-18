import { describe, it, expect } from 'vitest'
import { AccessDeniedError, ApprovalDeniedError, ApprovalTimeoutError, NetworkError } from '@agentvalet/client'
import { toToolFailure } from '../../src/tools/errors.js'

describe('toToolFailure', () => {
  it('turns a denial into an instruction, not a status code', () => {
    const msg = toToolFailure(new AccessDeniedError('not_granted'))
    expect(msg).toMatch(/owner/i)
    expect(msg).not.toMatch(/^\d{3}$/)
  })

  it('tells the model an approval was refused and not to retry', () => {
    const msg = toToolFailure(new ApprovalDeniedError('denied'))
    expect(msg).toMatch(/declined/i)
    expect(msg).toMatch(/do not retry/i)
  })

  it('distinguishes a timeout, which may be resumed, from a denial', () => {
    const msg = toToolFailure(new ApprovalTimeoutError('timeout'))
    expect(msg).toMatch(/still waiting|not yet/i)
    expect(msg).not.toMatch(/declined/i)
  })

  it('fails closed and says so when the broker is unreachable', () => {
    const msg = toToolFailure(new NetworkError('offline'))
    expect(msg).toMatch(/could not reach agentvalet/i)
    expect(msg).toMatch(/not been made/i)
  })

  it('reports a suspension with the owner reason, not breaker advice', () => {
    const err: any = new AccessDeniedError('agent_suspended')
    err.suspendedReason = 'Policy: no production writes during freeze'
    const msg = toToolFailure(err)
    expect(msg).toContain('Policy: no production writes during freeze')
    expect(msg).not.toMatch(/circuit breaker|wait.*reset/i)
  })

  it('never leaks a raw stack to the model', () => {
    const err = new Error('boom')
    err.stack = 'at /home/fixture/secret/path.ts:1'
    expect(toToolFailure(err)).not.toContain('/home/fixture')
  })
})
