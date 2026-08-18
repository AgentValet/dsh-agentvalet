import { describe, it, expect } from 'vitest'
import { AccessDeniedError, ApprovalDeniedError, ApprovalTimeoutError, NetworkError, ProxyError } from '@agentvalet/client'
import { toToolFailure } from '../../src/tools/errors.js'

describe('toToolFailure', () => {
  it('turns a denial into an instruction, not a status code', () => {
    const msg = toToolFailure(new AccessDeniedError(403, 'not_granted', 'slack', 'chat:write'))
    expect(msg).toMatch(/owner/i)
    expect(msg).not.toMatch(/^\d{3}$/)
  })

  it('tells the model an approval was refused and not to retry', () => {
    const msg = toToolFailure(new ApprovalDeniedError('approval-id', 'denied'))
    expect(msg).toMatch(/declined/i)
    expect(msg).toMatch(/do not retry/i)
  })

  it('distinguishes a timeout, which may be resumed, from a denial', () => {
    const msg = toToolFailure(new ApprovalTimeoutError('approval-id', 5000))
    expect(msg).toMatch(/still waiting|not yet/i)
    expect(msg).not.toMatch(/declined/i)
  })

  it('fails closed and says so when the broker is unreachable', () => {
    const msg = toToolFailure(new NetworkError('offline', new Error('net::ERR_NAME_NOT_RESOLVED')))
    expect(msg).toMatch(/could not reach agentvalet/i)
    expect(msg).toMatch(/not been made/i)
  })

  it('reports a suspension without breaker advice', () => {
    const msg = toToolFailure(new AccessDeniedError(403, 'agent_suspended', 'slack', 'chat:write'))
    expect(msg).toMatch(/suspended/i)
    expect(msg).not.toMatch(/circuit breaker|wait.*reset/i)
    expect(msg).toMatch(/nothing was sent/i)
  })

  it('never leaks a raw stack to the model', () => {
    const err = new Error('boom')
    err.stack = 'at /home/fixture/secret/path.ts:1'
    expect(toToolFailure(err)).not.toContain('/home/fixture')
  })

  // Fix 5: Branch order is load-bearing because AccessDeniedError extends ProxyError.
  // This test ensures we check AccessDeniedError before ProxyError in the chain.
  // If anyone reorders to check ProxyError first, every access denial silently becomes
  // a generic proxy failure and this test will catch it.
  it('returns access-denied message for AccessDeniedError, not ProxyError message', () => {
    const msg = toToolFailure(new AccessDeniedError(403, 'not_granted', 'slack', 'chat:write'))
    expect(msg).toContain('slack')
    expect(msg).toContain('chat:write')
    expect(msg).toMatch(/granted/i)
  })

  // Fix 2: Ensure secret-like response bodies from the proxy do not leak into the model.
  it('never leaks raw response bodies containing secrets from proxy errors', () => {
    const secretBody = '{"error":"bad token sk-live-SECRET123","status":401}'
    const msg = toToolFailure(new ProxyError(401, secretBody))
    expect(msg).not.toContain('sk-live-SECRET123')
    expect(msg).not.toContain(secretBody)
    expect(msg).toContain('401')
  })
})
