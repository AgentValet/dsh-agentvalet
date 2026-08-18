export class BindError extends Error {}

export interface BindOptions {
  bootstrapToken: string
  publicKeyPem: string
  proxyUrl: string
  fetch?: typeof globalThis.fetch
}

export interface BoundIdentity {
  agentId: string
  ownerId: string
}

/**
 * Enrol this profile via POST /v1/agents/bind. The bootstrap token IS the
 * credential; we send the public key only.
 */
export async function bindAgent(opts: BindOptions): Promise<BoundIdentity> {
  const doFetch = opts.fetch ?? globalThis.fetch
  const res = await doFetch(`${opts.proxyUrl}/v1/agents/bind`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      bootstrap_token: opts.bootstrapToken,
      public_key_pem: opts.publicKeyPem,
    }),
  })

  if (res.status === 410) {
    throw new BindError(
      'That bootstrap token has expired or already been used. Generate a new one in the AgentValet dashboard.',
    )
  }
  if (res.status === 429) {
    throw new BindError('Too many bind attempts. Wait a few minutes and try again.')
  }
  if (!res.ok) {
    throw new BindError(`AgentValet rejected the enrolment (HTTP ${res.status}).`)
  }

  // A 2xx is not a promise of JSON: a captive portal or an intermediary can
  // return HTML with status 200, and a raw SyntaxError here would surface as an
  // unhandled crash instead of an actionable bind failure.
  let body: { agent_id?: string; owner_id?: string }
  try {
    body = (await res.json()) as { agent_id?: string; owner_id?: string }
  } catch {
    throw new BindError(
      'AgentValet returned a response that was not JSON. Check that the proxy URL points at AgentValet and that no captive portal or proxy is intercepting the request.',
    )
  }
  if (!body.agent_id || !body.owner_id) {
    throw new BindError('AgentValet returned an incomplete enrolment response.')
  }
  return { agentId: body.agent_id, ownerId: body.owner_id }
}
