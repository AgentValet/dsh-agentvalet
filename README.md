# @agentvalet/dsh

Governed platform access for DeepSeek Harness agents: an agent calls Slack,
GitHub, Gmail, Stripe, or any other AgentValet-connected SaaS platform through
a broker that enforces the owner's grants and approval flow, with no API key
stored on the machine the agent runs on.

## Install

```bash
dsh plugin --profile web add @agentvalet/dsh
```

This installs both plugins the bundle ships: `av-identity` (the `agentvalet`
service) and `av-tools` (the four tools below). Restart or reload the profile
after installing.

## Connect

An installed but unconnected profile has no identity yet — calls report "not
connected" rather than failing obscurely. To connect it:

1. In the AgentValet dashboard, generate a single-use bootstrap token for a
   new agent.
2. Run the bundle's connect command:

```bash
AGENTVALET_BOOTSTRAP_TOKEN=<token> npx agentvalet-dsh-connect --profile web
```

`--token <token>` works too; the environment variable just keeps the token out
of your shell history. The command prints the new agent id and nothing else —
never the token, never the key. `--help` lists the rest of the flags.

Connecting is a **command you run**, not a tool the agent can call. An
enrolment tool would let an agent bootstrap its own identity with no human in
the loop, and the identity would stop attesting to a person's decision to
create it.

The command generates an RS256 keypair locally and sends only the **public**
key to AgentValet's `/v1/agents/bind` endpoint. The private key never leaves
the machine. It is written to `$DSH_HOME/agentvalet/<profile>.json`
(`~/.dsh/agentvalet/...` when `DSH_HOME` is unset) at mode `0600`, and the
store refuses outright to write anywhere inside a git working tree.

Once bound, the agent shows up in the dashboard **deny-by-default** — it can
call nothing until the owner grants it specific platforms and scopes.

A bootstrap token is single-use. Re-running connect on an already-connected
profile is refused rather than silently replacing the identity, so one
agent's audit history can never be laundered into another's.

## Tools

| Tool | Method | Notes |
|---|---|---|
| `agentvalet_list_platforms` | — | Lists platforms and scopes the owner has approved for this agent. Call this before any platform call — grants can change at any time. |
| `agentvalet_read_platform` | Always GET | Read from an approved platform. |
| `agentvalet_write_platform` | POST (default), PUT or PATCH | Create or update. May require owner approval. |
| `agentvalet_delete_platform` | Always DELETE | Usually requires owner approval. |

Every tool takes the `platform` id and `scope` string exactly as returned by
`agentvalet_list_platforms`, plus an `endpoint`. All four resolve to
`{ ok: true, data }` on success or `{ ok: false, error }` on failure — a
denial, a pending approval, or a suspended agent all come back as a plain
result the model can read and explain rather than as a thrown error. (That is
a guarantee about our own tool bodies. Argument validation happens in the
harness before our code runs, so a malformed call comes back in dsh's own
`isError` result shape instead.)

## What this does NOT do

- **No local policy engine.** Every grant, scope, and approval decision is
  evaluated by AgentValet's proxy, not by anything running on this machine.
- **No vault on disk beyond the agent's own signing key.** There is no
  platform credential to steal locally — API keys for Slack, GitHub, and the
  rest live only at the broker, never on the agent's host.
- **No sandboxing.** This plugin governs *which platform calls succeed*; it
  is not a substitute for running the harness in a sandbox and pairs with
  one rather than replacing it.
- **No sub-agent delegation and no attenuated scope re-issue.** This bundle
  implements neither. It enforces the owner's grants for this one agent, and
  that is all it does.

## Compatibility

Declared harness range: `>=0.1.0-rc.5 <0.2.0`. Verified against
`@deepseek-ai/dsh@0.1.0-rc.7`, `@deepseek-ai/cordis@4.0.1`, and
`@deepseek-ai/dsh-tools@0.1.0-rc.7` — see `VERIFICATION.md` for what was and
was not confirmed against a real harness run.
