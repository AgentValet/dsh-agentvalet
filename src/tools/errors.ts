import {
  AccessDeniedError, ApprovalDeniedError, ApprovalExpiredError,
  ApprovalTimeoutError, ConfigError, NetworkError, ProxyError, UpstreamError,
} from '@agentvalet/client'


/**
 * The proxy's denial body, read once. Shape (apps/proxy authorize.ts):
 * `{ error, reason, correlation_id, report_hint, access_request_hint }`.
 */
interface Denial {
  suspended: boolean
  correlationId?: string
}

function parseDenial(body: string): Denial {
  try {
    const parsed = JSON.parse(body) as { reason?: string; correlation_id?: string }
    return {
      suspended: parsed.reason === 'agent_suspended',
      ...(typeof parsed.correlation_id === 'string' && parsed.correlation_id
        ? { correlationId: parsed.correlation_id }
        : {}),
    }
  } catch {
    // Not JSON: an intermediary can return HTML with any status. Fall back to a
    // substring check so a shape change degrades rather than mislabelling a
    // suspension as an ordinary missing grant.
    return { suspended: body.includes('agent_suspended') }
  }
}

/**
 * A denial the owner cannot find in their audit log is a denial they cannot act
 * on. The correlation id is the only handle that ties this refusal to the exact
 * audit row, so it belongs in the sentence the user sees.
 */
function trace(correlationId?: string): string {
  return correlationId ? ` Quote correlation id ${correlationId} when asking them.` : ''
}

/**
 * Map a broker outcome to the sentence the model sees. Two rules: say what the
 * agent should do next, and never fail open — an unreachable broker means the
 * call did NOT happen, and the model must not assume otherwise.
 */
export function toToolFailure(err: unknown): string {
  // Check AccessDeniedError before ProxyError: this branch order is load-bearing
  // because AccessDeniedError extends ProxyError. Checking ProxyError first would
  // silently treat all access denials as generic proxy failures.
  if (err instanceof AccessDeniedError) {
    const denial = parseDenial(err.body)

    if (denial.suspended) {
      // A suspension is almost always deliberate policy enforcement, not the
      // circuit breaker. Telling someone to wait for a breaker reset when their
      // owner suspended them on purpose is worse than saying nothing.
      //
      // The owner's actual reason is NOT available here: the proxy's denial body
      // carries only `reason: "agent_suspended"`, and `suspended_reason` is a
      // column the dashboard reads, never part of the response. So this points
      // at the dashboard rather than paraphrasing a cause it cannot know.
      return (
        'This agent is suspended by its owner. Nothing was sent to the platform. ' +
        'The owner must lift the suspension at https://app.agentvalet.ai; do not retry until they do.' +
        trace(denial.correlationId)
      )
    }
    return (
      `AgentValet denied access to ${err.platform} with scope ${err.scope}. ` +
      'The owner has not granted this agent that platform and scope. ' +
      'Ask the user to grant it at https://app.agentvalet.ai, then try again.' +
      trace(denial.correlationId)
    )
  }
  if (err instanceof ApprovalDeniedError) {
    return `The owner declined this action. Do not retry it and do not attempt another route to the same result. Tell the user it was declined.`
  }
  if (err instanceof ApprovalExpiredError) {
    return `The approval request expired before the owner answered. The action did not happen. Ask the user whether to request it again.`
  }
  if (err instanceof ApprovalTimeoutError) {
    // NOT a failure. The action is still queued server-side and WILL run if the
    // owner approves. Telling the model "the action has not been performed"
    // invites a retry, and a retry after approval performs it twice — two Slack
    // messages, two Stripe charges.
    return `We stopped waiting for the owner, but the approval request is still pending (approval ${err.approvalId}) and the original action will still run if they approve it. Do NOT retry: retrying risks performing this action twice. Tell the user it is awaiting approval and point them at https://app.agentvalet.ai to approve or decline it.`
  }
  if (err instanceof NetworkError) {
    return `Could not reach AgentValet, so the call has not been made. Nothing was sent to the platform. Check connectivity and try again.`
  }
  if (err instanceof UpstreamError) {
    return `The platform returned HTTP ${err.status} and rejected the call. The call was made and may have had side effects. Check the platform to see what happened before retrying.`
  }
  if (err instanceof ProxyError) {
    return `AgentValet returned HTTP ${err.status} and the call did not complete.`
  }
  if (err instanceof ConfigError) {
    return `AgentValet is not configured for this profile. Connect this dsh profile to AgentValet with a bootstrap token from https://app.agentvalet.ai/settings.`
  }
  return 'The call failed for an unexpected reason and did not complete. Nothing was sent to the platform. Tell the user rather than retrying.'
}

/**
 * The approval this failure belongs to, when there is one, so the caller can be
 * resumed with `client.waitForApproval(approvalId)` instead of re-issuing the
 * action.
 */
export function approvalIdOf(err: unknown): string | undefined {
  if (
    err instanceof ApprovalTimeoutError ||
    err instanceof ApprovalDeniedError ||
    err instanceof ApprovalExpiredError
  ) {
    return err.approvalId
  }
  return undefined
}
