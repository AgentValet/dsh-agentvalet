# AgentValet

Platform access for this agent is brokered by AgentValet. No API keys are
stored on this machine.

## Routing rule

For any action on an external SaaS platform (Slack, GitHub, Gmail, Stripe,
Linear, Notion, and similar), call `agentvalet_list_platforms` FIRST. If the
platform appears, you MUST route the call through the AgentValet tools. Do not
call the platform's API directly and do not use another tool for it — other
routes bypass the audit log and the owner's approval flow.

| Operation | Tool |
|---|---|
| Read | `agentvalet_read_platform` (always GET) |
| Create or update | `agentvalet_write_platform` (POST, PUT or PATCH) |
| Delete | `agentvalet_delete_platform` (always DELETE) |

Pass the platform id and the scope string verbatim as returned by
`agentvalet_list_platforms`. Grants can change at any time; if a call fails,
list again before retrying.

If a call is declined by the owner, do not retry it and do not look for another
way to achieve the same result. Report the decline to the user.

If the platform is not listed, say so rather than falling back to a direct API
call.
