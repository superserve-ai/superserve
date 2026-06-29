import { readFileSync } from "node:fs"

import { runLoop } from "../lib/run-loop"
import type { LoopSpec } from "../lib/run-loop"

/**
 * PR Babysitter — orchestrator (runs on the cron host, NOT in a sandbox).
 *
 * This script is pure scheduling + lifecycle: find this repo's warm sandbox,
 * run ONE Claude Code tick inside it, pause. All the actual PR work — discover,
 * triage, fix, verify, comment, escalate — happens inside the box, driven by the
 * `pr-babysitter` skill (see ./skill/SKILL.md). The box boots from the
 * `superserve/claude-code` template, so the `claude` CLI is already installed.
 *
 * Auth is the headless Claude subscription path: a `CLAUDE_CODE_OAUTH_TOKEN`
 * (from `claude setup-token`) bound as a Superserve secret, so the token is
 * swapped in at egress and never lives in the box.
 *
 *   bun run pr-babysitter/loop.ts --repo owner/name            # one tick
 *   bun run pr-babysitter/loop.ts --repo owner/name --watch=15m
 *   bun run pr-babysitter/loop.ts --repo owner/name --dry-run  # no keys needed
 */

const TEMPLATE = "superserve/claude-code"
const REPO_DIR = "/home/user/repo"
const SKILL_UPLOAD_PATH = "/home/user/pr-babysitter.SKILL.md"

export interface ResolvedAuth {
  /** Superserve secret bindings: `{ ENV_VAR: secretName }`. */
  secrets: Record<string, string>
  /** Raw env vars passed through (dev path — value lives in the box). */
  envVars: Record<string, string>
}

/**
 * Resolve Claude + GitHub credentials into sandbox bindings. Prefers Superserve
 * secret NAMES (`SUPERSERVE_*_SECRET`) so the real value never enters the box;
 * falls back to raw tokens in env vars for local dev. Throws a helpful message
 * listing what's missing.
 */
export function resolveAuth(env: NodeJS.ProcessEnv): ResolvedAuth {
  const secrets: Record<string, string> = {}
  const envVars: Record<string, string> = {}
  const missing: string[] = []

  if (env.SUPERSERVE_CLAUDE_SECRET) {
    secrets.CLAUDE_CODE_OAUTH_TOKEN = env.SUPERSERVE_CLAUDE_SECRET
  } else if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    envVars.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN
  } else {
    missing.push(
      "Claude: set SUPERSERVE_CLAUDE_SECRET (name of a Superserve secret holding the OAuth token) " +
        "or CLAUDE_CODE_OAUTH_TOKEN (the raw token from `claude setup-token`).",
    )
  }

  // `gh` exports GH_TOKEN; raw PATs are usually GITHUB_TOKEN. Accept either, to
  // match the installer CLI's credential resolution.
  const githubToken = env.GITHUB_TOKEN || env.GH_TOKEN
  if (env.SUPERSERVE_GITHUB_SECRET) {
    secrets.GITHUB_TOKEN = env.SUPERSERVE_GITHUB_SECRET
  } else if (githubToken) {
    envVars.GITHUB_TOKEN = githubToken
  } else {
    missing.push(
      "GitHub: set SUPERSERVE_GITHUB_SECRET (name of a Superserve secret) or GITHUB_TOKEN / GH_TOKEN (a raw PAT).",
    )
  }

  if (missing.length > 0) {
    throw new Error(`Missing credentials:\n  - ${missing.join("\n  - ")}`)
  }
  return { secrets, envVars }
}

/** One-time bootstrap: install `gh` (root-free), place the skill, clone the repo. */
function setupScript(): string {
  return [
    "set -e",
    'export PATH="$HOME/.local/bin:$PATH"',
    "# The claude-code template ships `claude` but not `gh` — install it once (no root needed).",
    "if ! command -v gh >/dev/null 2>&1; then",
    "  GH_VERSION=2.63.2",
    '  curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o /tmp/gh.tgz',
    '  mkdir -p "$HOME/.local/bin"',
    "  tar -xzf /tmp/gh.tgz -C /tmp",
    '  cp "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" "$HOME/.local/bin/gh"',
    "fi",
    "# Make the PR-babysitter skill discoverable by Claude Code.",
    'mkdir -p "$HOME/.claude/skills/pr-babysitter"',
    `cp ${SKILL_UPLOAD_PATH} "$HOME/.claude/skills/pr-babysitter/SKILL.md"`,
    "# Clone the target repo ONCE. Every later tick resumes this warm checkout.",
    'git config --global user.name "loop-engineering[bot]"',
    'git config --global user.email "loops@superserve.ai"',
    `gh repo clone "$TARGET_REPO" ${REPO_DIR}`,
  ].join("\n")
}

/** Per-tick: refresh the warm checkout, run Claude Code headlessly on the skill. */
function iterateScript(): string {
  return [
    // Fail the tick if cd/fetch fail, instead of running claude in the wrong dir.
    "set -e",
    "# Subscription billing: ensure no metered API key out-ranks CLAUDE_CODE_OAUTH_TOKEN.",
    "unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN",
    'export PATH="$HOME/.local/bin:$PATH"',
    `cd ${REPO_DIR} && git fetch --all --prune --quiet`,
    'claude -p "/pr-babysitter Babysit the open PRs in $TARGET_REPO." \\',
    "  --permission-mode dontAsk \\",
    '  --allowedTools "Bash(gh *),Bash(git *),Read,Edit,Write,Glob,Grep" \\',
    "  --output-format json \\",
    "  --max-turns 50",
  ].join("\n")
}

/** Build the loop spec for a repo. Pure — easy to unit-test. */
export function buildSpec(config: {
  repo: string
  skill: string
  auth: ResolvedAuth
}): LoopSpec {
  return {
    name: "pr-babysitter",
    metadata: { loop: "pr-babysitter", repo: config.repo },
    template: TEMPLATE,
    secrets: config.auth.secrets,
    envVars: { ...config.auth.envVars, TARGET_REPO: config.repo },
    uploads: { [SKILL_UPLOAD_PATH]: config.skill },
    setup: setupScript(),
    iterate: iterateScript(),
    pauseWhenDone: true,
  }
}

// --- CLI ------------------------------------------------------------------

function getFlag(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1]
  return undefined
}

function parseDuration(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs
  const m = /^(\d+)(s|m|h)?$/.exec(value.trim())
  if (!m) return fallbackMs
  const n = Number(m[1])
  const unit = m[2] ?? "m"
  return n * (unit === "s" ? 1_000 : unit === "h" ? 3_600_000 : 60_000)
}

function printDryRun(spec: LoopSpec): void {
  const redactedEnv = Object.fromEntries(
    Object.keys(spec.envVars ?? {}).map((k) => [
      k,
      k === "TARGET_REPO" ? spec.envVars?.[k] : "<provided>",
    ]),
  )
  console.log(
    "[pr-babysitter] dry run — resolved loop spec (no sandbox created):\n",
  )
  console.log(`  template:  ${spec.template}`)
  console.log(`  metadata:  ${JSON.stringify(spec.metadata)}`)
  console.log(
    `  secrets:   ${JSON.stringify(spec.secrets)}   (ENV_VAR -> Superserve secret name)`,
  )
  console.log(`  envVars:   ${JSON.stringify(redactedEnv)}`)
  console.log(`  uploads:   ${Object.keys(spec.uploads ?? {}).join(", ")}`)
  console.log(`\n  --- setup (runs once) ---\n${spec.setup}`)
  console.log(`\n  --- iterate (runs every tick) ---\n${spec.iterate}`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const watch = args.some((a) => a === "--watch" || a.startsWith("--watch="))

  const repo = getFlag(args, "--repo") ?? process.env.REPO
  if (!repo) {
    console.error("error: pass --repo owner/name (or set REPO).")
    process.exit(1)
  }

  const skill = readFileSync(
    new URL("./skill/SKILL.md", import.meta.url),
    "utf8",
  )

  let auth: ResolvedAuth
  try {
    auth = resolveAuth(process.env)
  } catch (err) {
    if (!dryRun) {
      console.error(`error: ${(err as Error).message}`)
      process.exit(1)
    }
    auth = { secrets: {}, envVars: {} }
  }

  const spec = buildSpec({ repo, skill, auth })

  if (dryRun) {
    printDryRun(spec)
    return
  }

  const tick = async (): Promise<void> => {
    const result = await runLoop(spec)
    const mode = result.bootstrapped
      ? "cold start (bootstrapped)"
      : "warm resume"
    console.log(
      `\n[pr-babysitter] tick done — sandbox ${result.sandboxId}, ${mode}, exit ${result.exitCode}`,
    )
  }

  if (!watch) {
    await tick()
    return
  }

  const intervalMs = parseDuration(getFlag(args, "--watch"), 15 * 60_000)
  console.log(
    `[pr-babysitter] watching ${repo} every ${intervalMs / 1000}s — Ctrl-C to stop`,
  )
  // Recursive setTimeout, NOT setInterval: schedule the next tick only after the
  // current one settles. Ticks share one persistent box, so an overlapping run
  // (a slow tick outlasting the interval) would race on the same git checkout.
  await tick()
  const scheduleNext = (): void => {
    setTimeout(() => {
      void tick()
        .catch((err) => console.error(`[pr-babysitter] tick failed: ${err}`))
        .finally(scheduleNext)
    }, intervalMs)
  }
  scheduleNext()
}

// Only run when executed directly (so tests can import buildSpec/resolveAuth).
if ((import.meta as { main?: boolean }).main) {
  void main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
