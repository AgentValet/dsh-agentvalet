import { createAgentValetService, defaultHomeDir } from './index.js'
import { createFileCredentialStore } from './store.js'

/**
 * Enrolment lives here, behind a CLI — NOT behind a model-facing tool.
 *
 * A tool the model could call would let an agent enrol itself and bootstrap its
 * own identity with no human in the loop, so the identity would no longer
 * attest to a person's decision to create it. Keeping enrolment a human act is
 * a governance property of this package, not a UX preference. Do not "just add
 * a connect tool" to `src/tools/`.
 */

export const CONNECT_USAGE = `agentvalet-dsh-connect — connect a dsh profile to AgentValet

  --profile <name>   dsh profile to connect (default: "default")
  --token <token>    single-use bootstrap token from the AgentValet dashboard.
                     Omit it to read AGENTVALET_BOOTSTRAP_TOKEN instead, which
                     keeps the token out of your shell history.
  --home <dir>       where the identity is stored (default: $DSH_HOME, else ~/.dsh)
  --proxy <url>      AgentValet proxy URL (default: https://api.agentvalet.ai)
  --help
`

const DEFAULT_PROXY_URL = 'https://api.agentvalet.ai'
const FLAGS = ['profile', 'token', 'home', 'proxy'] as const
type Flag = (typeof FLAGS)[number]

export interface ConnectArgs extends Partial<Record<Flag, string>> {
  help?: true
}

export function parseConnectArgs(argv: readonly string[]): ConnectArgs {
  const out: ConnectArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--help' || arg === '-h') return { help: true }
    const match = /^--([a-z]+)(?:=([\s\S]*))?$/.exec(arg)
    const flag = FLAGS.find((f) => f === match?.[1])
    if (!flag) throw new Error(`Unrecognised argument: ${arg}`)
    const value = match?.[2] ?? argv[++i]
    if (value === undefined) throw new Error(`--${flag} needs a value.`)
    out[flag] = value
  }
  return out
}

export interface ConnectIO {
  argv: readonly string[]
  env: NodeJS.ProcessEnv
  /** Injected for tests; the real bin passes nothing and gets global fetch. */
  fetch?: typeof globalThis.fetch
}

/**
 * Run the connect flow and return the lines to print. Neither the bootstrap
 * token nor the private key is ever part of the returned text.
 */
export async function runConnect(io: ConnectIO): Promise<string> {
  const args = parseConnectArgs(io.argv)
  if (args.help) return CONNECT_USAGE

  const token = args.token ?? io.env.AGENTVALET_BOOTSTRAP_TOKEN
  if (!token) {
    throw new Error(
      'No bootstrap token. Pass --token, or set AGENTVALET_BOOTSTRAP_TOKEN. ' +
        'Generate one in the AgentValet dashboard at https://app.agentvalet.ai.',
    )
  }

  const profile = args.profile ?? 'default'
  const homeDir = args.home ?? defaultHomeDir(io.env)
  const service = await createAgentValetService({
    profile,
    proxyUrl: args.proxy ?? DEFAULT_PROXY_URL,
    store: createFileCredentialStore(homeDir),
    ...(io.fetch ? { fetch: io.fetch } : {}),
  })

  if (service.enrolled) {
    throw new Error(
      `Profile "${profile}" is already connected. Re-connecting is refused rather than ` +
        "silently replacing the identity, so one agent's audit history cannot be laundered " +
        "into another's. Remove the stored identity deliberately if you really mean to rebind.",
    )
  }

  await service.enrol(token)
  // The agent id is public and is what the owner needs in the dashboard.
  // The token and the key are not printed, here or anywhere.
  return (
    `Connected profile "${profile}" as ${service.client().agentId}.\n` +
    `Identity stored under ${homeDir}. The private key never left this machine.\n` +
    'The agent is deny-by-default: grant it platforms and scopes at https://app.agentvalet.ai.\n'
  )
}
