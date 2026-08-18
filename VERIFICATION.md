# Real-harness verification

Date: 2026-08-18. Bundle version verified: `@agentvalet/dsh@0.1.0`, built from
`lib/` via `npm run build` immediately before this run.

## What I could NOT get running, and why

The obvious command to try was:

```bash
npx @deepseek-ai/dsh@0.1.0-rc.7 web
```

I could not get the full `dsh` CLI to boot in this environment. Both
`npx --yes @deepseek-ai/dsh@0.1.0-rc.7 --help` and a plain
`npm install @deepseek-ai/dsh@0.1.0-rc.7` into a scratch directory hung
indefinitely — no stdout, no stderr, no `node_modules` created, still running
after 20+ minutes, and only stopped when I killed the OS processes myself.
This was **not** a general network problem: `curl` to
`registry.npmjs.org` returned in ~1-3s, and `npm pack` (single-tarball
fetch, no dependency resolution) succeeded immediately for every package I
tried. The distinguishing factor is dependency-graph size: `npm pack`ing
`@deepseek-ai/dsh@0.1.0-rc.7` and reading its `package.json` shows it depends
on **~60 first-party `@deepseek-ai/dsh-*` packages** (agent presets, terminal
tools, web app, MCP client, subagent control, etc.) plus their own
transitive trees. Full resolution of that graph never completed here. I did
not fabricate a pass to route around this; the failure is recorded as it
happened.

Given that, I could not verify against the *literal* `dsh web` command. I did
verify against the **real, unmodified, currently-published** harness
packages that the failed install would have used, three ways:

1. **Live in-process boot** — the strongest evidence below. I wrote a
   throwaway script (`scratch-verify.mjs`, deleted afterwards, never committed) that constructs a real `@deepseek-ai/cordis`
   `Context`, mounts the real `@deepseek-ai/dsh-tools` `ToolRuntime` and
   `@deepseek-ai/dsh-system-prompt` `SystemPrompt` (both already present as
   this bundle's own `devDependencies`, unmocked, pulled from the registry),
   then mounts this bundle's own compiled `av-identity` and `av-tools`
   plugins exactly as `cordis.patch.yml` configures them, and drove real
   calls through `ctx.tools.execute(...)` — the actual pipeline entry point
   dsh's agent loop uses (`tools/pre-execute` → guards → `execute` →
   `tools/post-execute` → `finalizeContent`), not a hand-rolled
   substitute. This is not a mock of the harness; it is the harness's own
   published tool-runtime and DI container, running for real, minus the CLI
   launcher, web UI, and LLM loop around it.
2. **Live standalone credential-service boot** — a second throwaway script
   (`cred-verify.mjs`, in a separate scratch npm project, deleted, not
   committed) installed `@deepseek-ai/dsh-credentials-local` (a small,
   ~14-package tree) and mounted it as a plugin on a real `Context`, then
   called its real `resolve`/`set`/`describe`.
3. **Static inspection of real installed/packed source** — `.d.ts` files and
   `README.md` from the actual published packages (not written by me), for
   facts the live runs didn't happen to exercise.

Package versions used for the live runs: `@deepseek-ai/cordis@4.0.1`,
`@deepseek-ai/dsh-tools@0.1.0-rc.7`, `@deepseek-ai/dsh-system-prompt@0.1.0-rc.7`,
`@deepseek-ai/dsh-credentials-local@0.1.0-rc.7`,
`@deepseek-ai/dsh-credentials@0.1.0-rc.7` — all installed directly from the
public npm registry, no local stubs.

---

## Q1: Is `ctx.provide('agentvalet', service)` genuinely the correct service registration at runtime?

**Yes — confirmed live.** In the in-process boot, after mounting `av-identity`
then `av-tools` (which declares `inject: ['agentvalet', 'tools']`), the script
printed:

```
typeof ctx.agentvalet: object
ctx.agentvalet.enrolled: false
```

`av-tools`' `apply()` only runs `ctx.tools.register(tool)` for each of the
four tools if its `inject` dependencies (`agentvalet`, `tools`) resolved —
Cordis defers a plugin's `apply` until its injected services exist. Since all
four tools *did* register (see Q2) and one of them (`agentvalet_list_platforms`)
demonstrably called into `ctx.agentvalet.client()` when executed (see Q5,
second call — it hit our own "not connected" throw), the injection genuinely
wired through at runtime, not just at the type level.

Cross-checked against `node_modules/@deepseek-ai/cordis/lib/types/reflect.d.ts`
(the real installed package, not a stub): `ctx.set(name, value)` docs say
"Only the fiber that provided the service may set it; setting an unprovided
name throws" — i.e. `set` cannot register a brand-new service name, only
`ctx.provide(name, value)` can. This matches the comment already in
`src/identity/index.ts` and is now confirmed by both the type contract and a
live successful registration.

## Q2: Do all four tools appear in the harness's tool list?

**Yes — confirmed live.** `ctx.tools.schemas()` (the real
`ToolRuntime.schemas(scope?)` method — this is the actual model-facing
listing API; it is *not* called `listTools`)
returned exactly:

```json
["agentvalet_list_platforms", "agentvalet_read_platform", "agentvalet_write_platform", "agentvalet_delete_platform"]
```

## Q3: Does a harness credential service exist that should replace our file-backed `CredentialStore`?

**Yes, and I ran it live.** `@deepseek-ai/dsh-app-boot`'s README documents a
first-party layered credential system: the inherited process environment
(read-only, always wins) over `$DSH_HOME/.credentials.yaml` (the
provider-managed, writable layer) over `<cwd>/.env` over `$DSH_HOME/.env`.
The abstract seam is `@deepseek-ai/dsh-credentials` (`ctx.credentials:
CredentialProvider`, methods `resolve(ref)`, `describe(ref)`, `set(ref,
value)`, `unset(ref)`); the file-backed implementation is
`@deepseek-ai/dsh-credentials-local` (`LocalCredentialProvider`), which
manages `$DSH_HOME/.credentials.yaml` at file mode `0600` under a `0700`
directory, with cross-process atomic writes, chokidar-based hot reload, and
strict validation (POSIX-identifier keys, non-empty string values only). A
source note in the `dsh` CLI's own bundled `agent-presets` composition doc
lists `credentials` alongside `tools`, `sessions`, `settings`, and
`telemetry` as one of the standard **host-composition services — "one
instance for the process"** — i.e. this is not an opt-in extra, it is part
of the normal running harness.

I mounted `LocalCredentialProvider` on a real `Context` and round-tripped a
multi-line value (deliberately shaped like a PEM block, to check our own
use case) under one `CredentialRef`:

```
typeof ctx.credentials: object
before set, describe(): { configured: false, writable: true }
after set, resolve(): { value: 'multi\nline\nvalue-with-PEM-like-content', source: 'file' }
after set, describe(): { configured: true, source: 'file', writable: true }
```

Confirmed live: an arbitrary multi-line string round-trips losslessly under
one reference key.

The store is deliberately **not** rewritten to use it. Here is what swapping
would involve, so it can be scoped later:

- The seam is a **flat mapping of `CredentialRef` (a single POSIX-identifier
  string) to one string value**, not a nested per-profile JSON document. Our
  `StoredIdentity` has three fields (`agentId`, `ownerId`, `privateKeyPem`)
  for potentially many profiles. Two viable shapes: (a) three refs per
  profile, e.g. `EXAMPLE_AGENTVALET_<PROFILE>_AGENT_ID` /
  `EXAMPLE_AGENTVALET_<PROFILE>_OWNER_ID` /
  `EXAMPLE_AGENTVALET_<PROFILE>_PRIVATE_KEY` (hypothetical names, prefixed so
  no reader mistakes them for config this package actually reads)
  (uppercased, sanitized profile name — profile names are not guaranteed
  POSIX-identifier-safe), or (b) one ref per profile holding a JSON-encoded
  `StoredIdentity` string (values round-trip losslessly per the test above,
  so this works, but stops using the store's line-level diffing/format
  preservation).
- `CredentialStore.load`/`save` are async and profile-keyed already, so the
  interface shape doesn't need to change — only `createFileCredentialStore`'s
  internals, behind the existing seam noted in `store.ts`'s own doc comment
  ("if the harness exposes a credential service, a second implementation
  swaps in behind this interface without touching callers").
- Gains: atomic cross-process-safe writes (ours is not lock-protected against
  a second concurrent `dsh` process), hot reload, and a permissions check
  that fails loud on POSIX if the file's mode ever drifts from `0600` (ours
  re-`chmod`s but never re-verifies on read).
- Loses/complicates: `ctx.credentials` requires an active `Context` — our
  `store.ts` is deliberately pure Node fs with no Cordis dependency, which is
  what lets `identity/index.ts`'s own tests construct a store without
  booting a harness at all. Swapping stores would mean `av-identity`'s
  `apply()` needs to `inject: ['credentials']` and the whole plugin becomes
  untestable without a Cordis context, which the current test suite
  (`test/identity/*.test.ts`) deliberately avoids.
- This document does not carry an agent id or scope list (`agentvalet_ref`
  values above are placeholders I chose for the demo, not real identifiers)
  — consistent with the no-secrets gate.

## Q4: The `ContentBlock` shape as actually rendered

**Confirmed live**, exactly matching our own `RESULT.render`:

```json
{ "type": "text", "text": "{\"ok\":false,\"error\":\"...\"}" }
```

This also matches the real `TextBlock` type in
`node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts`
(`interface TextBlock { type: 'text'; text: string }`,
`ContentBlockMap['text'] = TextBlock`), so both the compile-time contract
and the actual rendered value agree.

## Q5: does a `validateArgs` failure come back as our `{ok:false,error}` shape, or escape as a framework-level throw?

**Answered live, and it is neither of the two options as posed — it is a
third, better outcome.** I called
`ctx.tools.execute({ name: 'agentvalet_read_platform', arguments: { endpoint:
'/x', scope: 'read' } })` — omitting the required `platform` argument. It did
**not** throw out of `ctx.tools.execute`, and it did **not** reach our own
`execute` body (so our `{ok:false,error}` shape from `errors.ts` was never
invoked — `validateArgs` runs before our code does).
The real pipeline returned a normal, well-formed result:

```json
{
  "isError": true,
  "error": { "message": "invalid arguments: missing required property \"platform\"", "info": { "name": "ToolArgsError", "code": "INVALID_ARGS" } },
  "content": [{ "type": "text", "text": "Error: invalid arguments: missing required property \"platform\"" }]
}
```

So: a raw framework error does **not** escape to crash the process or bypass
error handling. `ToolRuntime` itself catches `ToolArgsError` and turns it into
a normal `ToolExecutionResult` with `isError: true` and a `content` block the
model reads like any other tool result. Our own error-mapping layer
(`toToolFailure`) is irrelevant to this path — it never runs, and doesn't
need to, because dsh-tools' own message is already actionable ("missing
required property \"platform\""). This was only reachable by driving a real
call through the real `ToolRuntime`.

## An incidental finding (not fixed, out of scope for this task)

The same live run surfaced a real gap in our own code, unrelated to the five
questions above: calling `agentvalet_list_platforms` against an **unenrolled**
profile did not produce the helpful `ConfigError` message
(`"AgentValet is not configured for this profile..."`). It fell through to
the generic fallback in `toToolFailure`:

```json
{ "ok": false, "error": "The call failed for an unexpected reason and did not complete." }
```

Root cause: `AgentValetService.client()` in `src/identity/index.ts` throws a
plain `new Error('This dsh profile is not connected to AgentValet...')`, not
an instance of `@agentvalet/client`'s `ConfigError`. `toToolFailure` only
recognizes `@agentvalet/client`'s own error classes, so a plain `Error` falls
through every `instanceof` check to the generic message — which loses the
"connect this profile with a bootstrap token" instruction the model actually
needs. This was a real, live-observed bug, not a documentation gap.

**Fixed since.** `client()` now throws `ConfigError`, so the actionable connect
sentence fires; covered by `test/identity/plugin.test.ts`.

---

## Files used for this verification (not committed)

- `scratch-verify.mjs` at the bundle root — booted `av-identity` + `av-tools`
  on a real `Context` with real `ToolRuntime`/`SystemPrompt`, deleted after
  use.
- A separate scratch npm project outside this repo with
  `@deepseek-ai/dsh-credentials-local` installed, and `cred-verify.mjs` in
  it — booted `LocalCredentialProvider` on a real `Context`, not part of
  this repo.

Both were throwaway verification scripts, not test suite additions; they are
not part of this commit.

---

## Q6: does dsh load a *dependency package's* root `AGENTS.md`?

**Not established. Treat `AGENTS.md` in this package as unproven.**

`AGENTS.md` is in `package.json`'s `files` and is content-tested, but nothing
found here shows that dsh reads an installed dependency's root `AGENTS.md`. The
only `AGENTS.md` reference in the packages installed in this repo is in
`@deepseek-ai/dsh-session`'s event docs, which describe "subdir AGENTS.md"
being injected as synthetic context — a *project-tree* convention (project root
and its subdirectories, or `$DSH_HOME`), not a node_modules scan. The loader
itself lives in the CLI/app-boot packages, which could not be installed here
(see the top of this document), so it could not be inspected.

Consequences, stated plainly: the routing instructions in `AGENTS.md` may never
reach a model. What *does* demonstrably reach the model is each tool's own
`description` in `src/tools/define.ts`, which is why the "call
`agentvalet_list_platforms` first, pass platform and scope verbatim" instruction
is repeated there. `AGENTS.md` ships as a best-effort duplicate of that
guidance, and as documentation for a human who copies it into their own project
root. Anyone who can boot the full harness should confirm whether it is loaded
before treating it as an enforcement surface.

---

## Not verified against a real harness

- The `cordis.patch.yml` install path (`dsh plugin add @agentvalet/dsh`) — the
  CLI would not install here.
- Any end-to-end call against the live AgentValet proxy. Every broker outcome
  in the test suite is exercised through the `@agentvalet/client` error classes,
  not against production.

