import { describe, it, expect } from 'vitest'
import { AccessDeniedError, ApprovalDeniedError, ApprovalTimeoutError, NetworkError, ProxyError } from '@agentvalet/client'
import { toToolFailure } from '../../src/tools/errors.js'

describe('toToolFailure', () => {
  it('turns a denial into an instruction, not a status code', () => {
    const denialBody = JSON.stringify({
      error: 'Permission denied',
      reason: 'no_grant',
      correlation_id: 'c1',
    })
    const msg = toToolFailure(new AccessDeniedError(403, denialBody, 'slack', 'chat:write'))
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

  it('detects agent suspension from realistic JSON body shape', () => {
    const suspensionBody = JSON.stringify({
      error: 'Permission denied',
      reason: 'agent_suspended',
      correlation_id: 'c1',
    })
    const msg = toToolFailure(new AccessDeniedError(403, suspensionBody, 'slack', 'chat:write'))
    expect(msg).toMatch(/suspended/i)
    expect(msg).not.toMatch(/circuit breaker|wait.*reset/i)
    expect(msg).toMatch(/nothing was sent/i)
  })

  it('distinguishes suspension from ordinary denial by reason field', () => {
    // Same JSON structure, different reason. This proves the detection is discriminating,
    // not matching all AccessDeniedError cases.
    const denialBody = JSON.stringify({
      error: 'Permission denied',
      reason: 'no_grant',
      correlation_id: 'c1',
    })
    const msg = toToolFailure(new AccessDeniedError(403, denialBody, 'slack', 'chat:write'))
    expect(msg).toMatch(/owner has not granted/i)
    expect(msg).not.toMatch(/suspended/i)
  })

  it('handles non-JSON body without throwing', () => {
    const htmlBody = '<html><body>502 Bad Gateway</body></html>'
    const msg = toToolFailure(new AccessDeniedError(403, htmlBody, 'slack', 'chat:write'))
    // Should return a string and not throw
    expect(msg).toBeTypeOf('string')
    expect(msg.length).toBeGreaterThan(0)
    // Should fall back to substring check (no 'agent_suspended' in this body)
    expect(msg).toMatch(/owner has not granted/i)
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
