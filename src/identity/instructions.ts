import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The routing rule, written where dsh will actually read it.
 *
 * This package ships an `AGENTS.md` at its own root, and that file is NOT
 * loaded by the harness. `@deepseek-ai/dsh-agent-instructions` reads
 * `$DSH_HOME/AGENTS.md` and then each directory from the project root down to
 * the session cwd. It never scans `node_modules`, so a dependency's root
 * `AGENTS.md` reaches nobody. The shipped copy is documentation for a human;
 * THIS is the copy the model sees.
 */

/** Fences the managed region so re-connecting updates rather than duplicates. */
export const BLOCK_START = '<!-- agentvalet:start -->'
export const BLOCK_END = '<!-- agentvalet:end -->'

/**
 * Deliberately no agent id, owner id, or scope list. This file is written to a
 * developer's home directory and is routinely copied into project roots and
 * pasted into issues; identity in it would leak by the ordinary use of it.
 */
export const ROUTING_BLOCK = `${BLOCK_START}
# AgentValet

Platform access for this agent is brokered by AgentValet. No API keys are
stored on this machine.

For any action on an external SaaS platform (Slack, GitHub, Gmail, Stripe,
Linear, Notion, and similar), call \`agentvalet_list_platforms\` FIRST. If the
platform appears, route the call through the AgentValet tools. Do not call the
platform's API directly and do not use another tool for it — other routes
bypass the audit log and the owner's approval flow.

| Operation | Tool |
|---|---|
| Read | \`agentvalet_read_platform\` (always GET) |
| Create or update | \`agentvalet_write_platform\` (POST, PUT or PATCH) |
| Delete | \`agentvalet_delete_platform\` (always DELETE) |

Pass the platform id and the scope string verbatim as returned by
\`agentvalet_list_platforms\`. Grants can change at any time; if a call fails,
list again before retrying.

If a call is declined by the owner, do not retry it and do not look for another
way to achieve the same result. Report the decline to the user.

If the platform is not listed, say so rather than falling back to a direct API
call.
${BLOCK_END}`

/** What `writeRoutingInstructions` did, so the caller can say so plainly. */
export type InstructionsOutcome =
  | { kind: 'created'; path: string }
  | { kind: 'updated'; path: string }
  | { kind: 'unchanged'; path: string }
  | { kind: 'failed'; path: string; error: string }

/**
 * Write or refresh the managed block in `<dshHome>/AGENTS.md`.
 *
 * Never rewrites the whole file: anything outside the fences is the user's and
 * is preserved byte for byte. A file that already has the fences has only the
 * region between them replaced.
 *
 * Never throws. This runs immediately after enrolment, at which point the
 * single-use bootstrap token is already spent and the identity is already on
 * disk — failing the command here would strand a real agent behind an error
 * about a markdown file. The outcome is returned so the caller can report it.
 */
export async function writeRoutingInstructions(dshHome: string): Promise<InstructionsOutcome> {
  const path = join(dshHome, 'AGENTS.md')
  try {
    let existing = ''
    try {
      existing = await readFile(path, 'utf8')
    } catch {
      // No file yet, or unreadable: treat as empty and create it below.
      existing = ''
    }

    const start = existing.indexOf(BLOCK_START)
    const end = existing.indexOf(BLOCK_END)

    if (start !== -1 && end !== -1 && end > start) {
      const before = existing.slice(0, start)
      const after = existing.slice(end + BLOCK_END.length)
      const next = `${before}${ROUTING_BLOCK}${after}`
      if (next === existing) return { kind: 'unchanged', path }
      await writeFile(path, next, 'utf8')
      return { kind: 'updated', path }
    }

    // Append, keeping one blank line between the user's content and ours.
    const separator = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
    await mkdir(dshHome, { recursive: true })
    await writeFile(path, `${existing}${separator}${ROUTING_BLOCK}\n`, 'utf8')
    return { kind: existing.length === 0 ? 'created' : 'updated', path }
  } catch (err) {
    return { kind: 'failed', path, error: err instanceof Error ? err.message : String(err) }
  }
}
