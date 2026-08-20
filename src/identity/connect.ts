import { createAgentValetService, defaultHomeDir } from './index.js'
import { createFileCredentialStore } from './store.js'
import { writeRoutingInstructions, type InstructionsOutcome } from './instructions.js'

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
    if (!flag) {
      // Never echo the argument's value: a mistyped flag (e.g. --tokn=<the
      // bootstrap token>) or a bare positional (the token pasted with no
      // flag at all) would otherwise print a single-use credential straight
      // to the terminal and into CI logs. Name only the flag portion (before
      // the first "="), or, for a bare positional, name none of it.
      if (arg.startsWith('--')) {
        const eq = arg.indexOf('=')
        const flagPart = eq === -1 ? arg : arg.slice(0, eq)
        throw new Error(`Unrecognised argument: ${flagPart}`)
      }
      throw new Error(
        'Unrecognised positional argument. Bootstrap tokens must be passed with --token, not bare on the command line.',
      )
    }
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

  // Teach the agent the routing rule at the same moment it gains the capability.
  //
  // Written to $DSH_HOME, NOT to `homeDir`: those are the same by default, but
  // --home only relocates where the identity is stored, and the instruction
  // loader reads $DSH_HOME/AGENTS.md and the project tree. Following --home here
  // would put the file somewhere nothing reads.
  const instructions = await writeRoutingInstructions(defaultHomeDir(io.env))

  // The agent id is public and is what the owner needs in the dashboard.
  // The token and the key are not printed, here or anywhere.
  return (
    `Connected profile "${profile}" as ${service.client().agentId}.\n` +
    `Identity stored under ${homeDir}. The private key never left this machine.\n` +
    `${describeInstructions(instructions)}\n` +
    'The agent is deny-by-default: grant it platforms and scopes at https://app.agentvalet.ai.\n'
  )
}

/**
 * Enrolment has already succeeded by the time this runs, so a failure here is
 * reported rather than thrown — but it is reported, not swallowed: without the
 * block the model is never told to route through AgentValet, and the only
 * remaining instruction is each tool's own description.
 */
function describeInstructions(outcome: InstructionsOutcome): string {
  switch (outcome.kind) {
    case 'created':
      return `Routing instructions written to ${outcome.path}.`
    case 'updated':
      return `Routing instructions refreshed in ${outcome.path}.`
    case 'unchanged':
      return `Routing instructions already current in ${outcome.path}.`
    case 'failed':
      return (
        `WARNING: could not write routing instructions to ${outcome.path} (${outcome.error}). ` +
        'The agent is connected, but nothing tells the model to route platform calls through ' +
        'AgentValet. Add the block by hand, or re-run this command once the path is writable.'
      )
  }
}
