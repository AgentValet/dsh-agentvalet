import {
  AccessDeniedError, ApprovalDeniedError, ApprovalExpiredError,
  ApprovalTimeoutError, ConfigError, NetworkError, ProxyError, UpstreamError,
} from '@agentvalet/client'

/**
 * Map a broker outcome to the sentence the model sees. Two rules: say what the
 * agent should do next, and never fail open — an unreachable broker means the
 * call did NOT happen, and the model must not assume otherwise.
 */
export function toToolFailure(err: unknown): string {
  if (err instanceof AccessDeniedError) {
    // A suspension is almost always deliberate policy enforcement, not the
    // circuit breaker. Telling someone to wait for a breaker reset when their
    // owner suspended them on purpose is worse than saying nothing.
    const reason = (err as { suspendedReason?: string }).suspendedReason
    if (reason) {
      return `This agent is suspended by its owner. Reason: ${reason}. Nothing was sent to the platform. The owner must lift the suspension at https://app.agentvalet.ai; do not retry until they do.`
    }
    return `AgentValet denied this call: ${err.message}. The owner has not granted this agent that platform and scope. Ask the user to grant it at https://app.agentvalet.ai, then try again.`
  }
  if (err instanceof ApprovalDeniedError) {
    return `The owner declined this action. Do not retry it and do not attempt another route to the same result. Tell the user it was declined.`
  }
  if (err instanceof ApprovalExpiredError) {
    return `The approval request expired before the owner answered. The action did not happen. Ask the user whether to request it again.`
  }
  if (err instanceof ApprovalTimeoutError) {
    return `The owner has not yet answered the approval request; it is still waiting. The action has not been performed. Do not retry immediately.`
  }
  if (err instanceof NetworkError) {
    return `Could not reach AgentValet, so the call has not been made. Nothing was sent to the platform. Check connectivity and try again.`
  }
  if (err instanceof ConfigError) {
    return `AgentValet is not configured for this profile: ${err.message}`
  }
  if (err instanceof ProxyError || err instanceof UpstreamError) {
    return `The call failed: ${err.message}`
  }
  return 'The call failed for an unexpected reason and did not complete.'
}
