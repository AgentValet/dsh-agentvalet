import { defineTool, type JsonValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { AgentValetService } from '../identity/index.js'
import { approvalIdOf, toToolFailure } from './errors.js'

/** The value every tool's `execute` resolves to. */
type ToolOutcome =
  | { ok: true; data: JsonValue }
  // `approvalId` is present when the failure belongs to an approval that can be
  // resumed rather than re-issued.
  | { ok: false; error: string; approvalId?: string }

/**
 * Every tool returns this shape rather than throwing: `{ ok: true, data }` on
 * success, `{ ok: false, error }` on failure. A tool that throws out of
 * `execute` would bypass the error mapping in `./errors.ts`.
 */
const RESULT = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown) => [
    { type: 'text' as const, text: JSON.stringify(value) },
  ],
}

const target = {
  platform: {
    type: 'string' as const,
    required: true as const,
    description: 'Platform id from agentvalet_list_platforms.',
  },
  endpoint: {
    type: 'string' as const,
    required: true as const,
    description: 'Path on the platform API, e.g. /users/me.',
  },
  scope: {
    type: 'string' as const,
    required: true as const,
    description: 'Granted scope string, verbatim from agentvalet_list_platforms.',
  },
  connectionId: {
    type: 'string' as const,
    description: 'Pick one connection when the platform has several.',
  },
  reason: {
    type: 'string' as const,
    description: 'Justification shown to the owner if this needs approval.',
  },
}

export function buildTools(svc: AgentValetService): ToolDefinition[] {
  // The broker returns a parsed HTTP response body, which is always JSON on
  // the wire; the client types it `unknown` because it cannot know the shape
  // of an arbitrary platform's response ahead of time.
  const run = async (fn: () => Promise<unknown>): Promise<ToolOutcome> => {
    try {
      return { ok: true, data: (await fn()) as JsonValue }
    } catch (err) {
      const approvalId = approvalIdOf(err)
      return { ok: false, error: toToolFailure(err), ...(approvalId ? { approvalId } : {}) }
    }
  }

  return [
    defineTool({
      name: 'agentvalet_list_platforms',
      description:
        'List the platforms and scopes the owner has approved for this agent. Call this before any platform call; grants can change at any time.',
      parameters: {},
      output: RESULT,
      execute: async () => run(() => svc.client().listPlatforms()),
    }),

    defineTool({
      name: 'agentvalet_read_platform',
      description:
        'Read from an approved platform through AgentValet. Always a GET. Call agentvalet_list_platforms first and pass platform and scope verbatim from its result.',
      parameters: target,
      output: RESULT,
      execute: async (args) => run(() => svc.client().call({ ...args, method: 'GET' })),
    }),

    defineTool({
      name: 'agentvalet_write_platform',
      description:
        'Create or update on an approved platform through AgentValet. POST by default; PUT or PATCH allowed. May require owner approval. Call agentvalet_list_platforms first and pass platform and scope verbatim from its result.',
      parameters: {
        ...target,
        method: {
          type: 'string' as const,
          // Declared as an enum so dsh-tools' own `validateArgs` rejects
          // anything else before `execute` runs, and the model reads the
          // restriction off the schema instead of discovering it by failing.
          enum: ['POST', 'PUT', 'PATCH'] as const,
          description: 'POST (default), PUT or PATCH.',
        },
        data: {
          type: 'json' as const,
          description: 'Request body.',
        },
      },
      output: RESULT,
      execute: async (args): Promise<ToolOutcome> => {
        // Belt and braces: the schema enum already rejects anything else
        // upstream, but a caller that bypasses validateArgs must not slip a
        // DELETE through the write tool.
        const method = String(args.method ?? 'POST').toUpperCase()
        if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
          return {
            ok: false,
            error:
              'write_platform accepts only POST, PUT or PATCH. Use agentvalet_read_platform to read and agentvalet_delete_platform to delete.',
          }
        }
        return run(() => svc.client().call({ ...args, method }))
      },
    }),

    defineTool({
      name: 'agentvalet_delete_platform',
      description:
        'Delete on an approved platform through AgentValet. Always a DELETE. Usually requires owner approval. Call agentvalet_list_platforms first and pass platform and scope verbatim from its result.',
      parameters: target,
      output: RESULT,
      execute: async (args) => run(() => svc.client().call({ ...args, method: 'DELETE' })),
    }),
  ]
}
