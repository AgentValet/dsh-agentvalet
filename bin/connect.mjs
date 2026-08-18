#!/usr/bin/env node
// Connect one dsh profile to AgentValet.
//
// Enrolment is a CLI and NOT a model-facing tool, deliberately: a tool the
// model could call would let an agent bootstrap its own identity with no human
// in the loop. See the comment in src/identity/connect.ts.
//
// Neither the bootstrap token nor the private key is ever printed.
import { runConnect } from '../lib/identity/connect.js'

try {
  process.stdout.write(await runConnect({ argv: process.argv.slice(2), env: process.env }))
} catch (err) {
  // Every message raised on this path is ours or the client's; none embed the token.
  process.stderr.write(`agentvalet-dsh-connect: ${err.message}\n`)
  process.exitCode = 1
}
