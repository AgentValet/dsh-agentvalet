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

  const body = (await res.json()) as { agent_id?: string; owner_id?: string }
  if (!body.agent_id || !body.owner_id) {
    throw new BindError('AgentValet returned an incomplete enrolment response.')
  }
  return { agentId: body.agent_id, ownerId: body.owner_id }
}
