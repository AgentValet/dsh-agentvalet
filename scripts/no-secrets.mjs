#!/usr/bin/env node
// scripts/no-secrets.mjs
//
// Publish tripwire. Refuses to ship a package whose tarball contains ANY
// sensitive material — credentials, identity, internal infrastructure.
//
// It exists because tooling can append an agent identity block to a file that
// is about to be published, and an npm version cannot be unpublished after 72h.
//
// Two independent layers, because either alone has a blind spot:
//
//   1. PATTERNS — known shapes (key material, vendor token formats, identity,
//      connection strings, internal hosts). Catches secrets this repo has never
//      seen, but only ones whose shape was anticipated.
//   2. VALUE CROSS-CHECK — every value in the repo-root .env, plus any literal
//      supplied through the local denylist below, is searched for verbatim in
//      the shipping files. Catches ANY real secret regardless of format,
//      including ones no pattern would match.
//
// Scans exactly what `npm pack` would ship, so the `files` allowlist and
// .npmignore are honoured and the guard does not cry wolf over local-only
// artifacts. A guard that fires on noise gets switched off.
//
// Secret VALUES are never printed — only the variable name and the file.
//
// Run from a package directory. Exit 0 = clean, 1 = something sensitive found.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// This repo is standalone: package.json and any .env live in the directory the
// script runs from.
const ROOT = process.cwd();
const REPO_ROOT = ROOT;

// ── Layer 1: shape-based patterns ────────────────────────────────────────────
// Deliberately value-shaped, not name-shaped: matching the word "password"
// finds documentation, matching an actual credential finds a leak.
const PATTERNS = [
  // — AgentValet identity / internal posture —
  // Excludes documented placeholders. A real id is random base36.
  { re: /\bagt_(?!example|your|test|placeholder|xxxx)[a-z0-9]{16,}\b/i, what: "AgentValet agent id" },
  { re: /\bOwner ID:\s*`?[0-9a-f]{8}-[0-9a-f]{4}-/i, what: "owner id" },
  { re: /^#+\s*AgentValet Permissions\s*$/im, what: "injected permissions block" },
  { re: /Last refreshed:\s*\d{4}-\d{2}-\d{2}T/i, what: "register-refresh timestamp" },

  // — key material — requires a real base64 body; a bare PEM header is
  //   legitimate in key-validation and key-generation code.
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\s]{100,}/, what: "private key material" },
  { re: /-----BEGIN OPENSSH PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\s]{100,}/, what: "SSH private key" },

  // — vendor credentials —
  { re: /\bnpm_[A-Za-z0-9]{36}\b/, what: "npm token" },
  { re: /\bpypi-[A-Za-z0-9_-]{40,}/, what: "PyPI token" },
  { re: /\bsk_(live|test)_[A-Za-z0-9]{16,}/, what: "Stripe secret key" },
  { re: /\b(ghp|gho|ghu|ghs)_[A-Za-z0-9]{36}\b/, what: "GitHub token" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/, what: "GitHub fine-grained PAT" },
  // Real shape is xoxb-<digits>-<digits>-<random>. Matching the looser
  // `xox?-anything` fires on deliberate "don't do this" placeholders in
  // teaching material.
  { re: /\bxox[baprs]-\d{9,}-\d{9,}-[A-Za-z0-9]{20,}/, what: "Slack token" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, what: "AWS access key id" },
  { re: /\bsb_secret_[A-Za-z0-9_-]{20,}/, what: "Supabase secret key" },
  { re: /\bcfut_[A-Za-z0-9]{30,}/, what: "Cloudflare token" },
  { re: /\bnango_[A-Za-z0-9_-]{20,}/, what: "Nango secret key" },
  // Signed JWT: header.payload.signature with a real signature segment.
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/, what: "signed JWT" },

  // — connection strings with embedded credentials —
  { re: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s:@/]+@/i, what: "connection string with password" },

  // — internal infrastructure —
  // Generic shapes only. This file is published with the repo, so a specific
  // hostname, IP, or project ref belongs in the local denylist below — writing
  // one here would BE the leak the guard exists to prevent.
  { re: /\bhttps?:\/\/[a-z0-9]{20}\.supabase\.co/i, what: "Supabase project URL" },
  { re: /\bvault\.azure\.net\b/i, what: "Azure Key Vault hostname" },
  // A bare public IPv4 literal in shipping text is almost always an origin
  // server nobody meant to publish. Private, loopback, link-local and the
  // RFC 5737 documentation ranges are excluded.
  {
    re: /\b(?!127\.|0\.|10\.|192\.168\.|169\.254\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|255\.)(?:\d{1,3}\.){3}\d{1,3}\b/,
    what: "bare public IPv4 address",
  },

  // — generic assignment of a long opaque value to a secret-ish name —
  {
    re: /\b(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_?KEY|CLIENT_SECRET|ACCESS_KEY)\b\s*[:=]\s*["']?[A-Za-z0-9_\-+/=]{20,}/i,
    what: "credential assigned to a secret-named variable",
  },
];

// ── local denylist: literals too specific to commit ──────────────────────────
// This script ships in a public repo, so a production hostname or project ref
// written into it IS the leak it is meant to prevent. Supply those out of band:
//
//   NO_SECRETS_DENYLIST="origin.example,<your-origin-ip>"  (comma-separated), or
//   a gitignored .no-secrets-denylist file, one literal per line (# comments).
//
// With neither present the generic patterns above still run.
function localDenylist() {
  const out = [];
  const push = (raw) => {
    const value = raw.trim();
    if (value && !value.startsWith("#")) out.push(value);
  };
  for (const value of (process.env.NO_SECRETS_DENYLIST ?? "").split(",")) push(value);
  const file = join(REPO_ROOT, ".no-secrets-denylist");
  if (existsSync(file)) for (const line of readFileSync(file, "utf8").split(/\r?\n/)) push(line);
  return out;
}

// Values this short, or this common, would produce noise rather than signal.
const MIN_ENV_VALUE_LEN = 12;
const ENV_VALUE_DENYLIST = new Set(["true", "false", "localhost", "development", "production"]);

// ── what would actually ship ─────────────────────────────────────────────────
// Ask the packer, so `files` and .npmignore are honoured exactly.
//
// maxBuffer is raised well above the default 1 MB: a large pack list blows the
// default and spawnSync dies with a bare ENOBUFS, which reads as "the guard is
// broken" rather than "something went wrong here". A security tool people
// distrust is a security tool people skip.
function filesThatWouldShip() {
  if (!existsSync(join(ROOT, "package.json"))) {
    throw new Error("no package.json — not a publishable package directory");
  }
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  return (JSON.parse(out)[0]?.files ?? []).map((f) => f.path);
}

// ── Layer 2: real values from .env ───────────────────────────────────────────
function envSecrets() {
  const envPath = join(REPO_ROOT, ".env");
  if (!existsSync(envPath)) return [];
  const out = [];
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const name = m[1];
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (value.length < MIN_ENV_VALUE_LEN) continue;
    if (ENV_VALUE_DENYLIST.has(value.toLowerCase())) continue;
    out.push({ name, value });
  }
  return out;
}

let shipping;
try {
  shipping = filesThatWouldShip();
} catch (err) {
  console.error(`[no-secrets] could not resolve the pack list: ${err.message}`);
  console.error("Refusing to publish rather than scanning nothing.");
  process.exit(1);
}

const SCAN_EXT = /\.(md|json|js|mjs|cjs|ts|tsx|map|yaml|yml|txt|toml|sh|html|css)$/i;
const secrets = envSecrets();
const denied = localDenylist();
const hits = [];

for (const rel of shipping.filter((f) => SCAN_EXT.test(f))) {
  let text;
  try {
    text = readFileSync(join(ROOT, rel), "utf8");
  } catch {
    continue;
  }
  for (const { re, what } of PATTERNS) {
    if (re.test(text)) hits.push({ file: rel, what });
  }
  // Never print the value itself — the variable name localises it well enough.
  for (const { name, value } of secrets) {
    if (text.includes(value)) hits.push({ file: rel, what: `literal value of ${name} from .env` });
  }
  for (const value of denied) {
    if (text.includes(value)) hits.push({ file: rel, what: "literal from the local denylist" });
  }
}

const pkgName = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name;
  } catch {
    return ROOT;
  }
})();

if (hits.length === 0) {
  console.log(
    `[no-secrets] ok — ${pkgName}: ${shipping.length} shipping files, ` +
      `${PATTERNS.length} patterns, ${secrets.length} .env values and ` +
      `${denied.length} denylist literals cross-checked`,
  );
  process.exit(0);
}

console.error(`\n[no-secrets] REFUSING TO PUBLISH ${pkgName}\n`);
for (const h of hits) console.error(`  ${h.file}  —  ${h.what}`);
console.error(
  "\nSomething sensitive is inside the tarball this publish would upload.\n" +
    "Do NOT publish past this. An npm version cannot be unpublished after 72h\n" +
    "and can never be reused afterwards; assume anything uploaded is permanent.\n",
);
process.exit(1);
