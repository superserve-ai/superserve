import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { Secret } from "@superserve/sdk"

/**
 * `superserve-loops add pr-babysitter` — one-command install of a loop into the
 * current repo. Creates the Superserve secrets, vendors the runtime, writes the
 * GitHub Actions workflow, and sets the `SUPERSERVE_API_KEY` repo secret.
 *
 *   bunx @superserve/loops add pr-babysitter            # interactive
 *   SUPERSERVE_API_KEY=… CLAUDE_CODE_OAUTH_TOKEN=… GITHUB_TOKEN=… \
 *     bunx @superserve/loops add pr-babysitter --yes    # non-interactive
 *
 * Tokens you provide are turned into Superserve secrets (swapped in at egress,
 * never committed, never seen by the box). Only the workflow file and the
 * encrypted `SUPERSERVE_API_KEY` Actions secret touch your repo.
 */

const SDK_VERSION = "^0.7.7"
const CLAUDE_SECRET = "claude-oauth"
const GITHUB_SECRET = "loop-github-token"

const c = {
  ok: (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`),
  warn: (s: string) => console.log(`  \x1b[33m!\x1b[0m ${s}`),
  step: (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`),
  info: (s: string) => console.log(`    ${s}`),
}

function fail(message: string): never {
  console.error(`\x1b[31merror:\x1b[0m ${message}`)
  process.exit(1)
}

// --- small shell helpers ---------------------------------------------------

function tryExec(file: string, args: string[]): string | undefined {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return undefined
  }
}

function detectRepo(flag: string | undefined): string {
  if (flag) return flag
  const url = tryExec("git", ["config", "--get", "remote.origin.url"])
  const m = url
    ? /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(url)
    : null
  if (!m) {
    fail(
      "could not detect the GitHub repo. Pass --repo owner/name (run inside a repo with a github.com remote).",
    )
  }
  return `${m[1]}/${m[2]}`
}

/** Read a secret from the terminal without echoing it. */
function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process
    if (!stdin.isTTY)
      fail(`missing credential and no TTY to prompt. ${query.trim()}`)
    stdout.write(query)
    stdin.setRawMode(true)
    stdin.resume()
    let buf = ""
    const onData = (d: Buffer): void => {
      const ch = d.toString("utf8")
      const code = ch.charCodeAt(0)
      if (code === 13 || code === 10 || code === 4) {
        // Enter / Ctrl-D — submit
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off("data", onData)
        stdout.write("\n")
        resolve(buf.trim())
      } else if (code === 3) {
        // Ctrl-C — abort
        stdin.setRawMode(false)
        process.exit(1)
      } else if (code === 127 || code === 8) {
        // Backspace
        buf = buf.slice(0, -1)
      } else {
        buf += ch
      }
    }
    stdin.on("data", onData)
  })
}

interface Flags {
  repo?: string
  apiKey?: string
  claudeToken?: string
  githubToken?: string
  dryRun: boolean
  yes: boolean
}

function parseFlags(args: string[]): Flags {
  const get = (name: string): string | undefined => {
    const eq = args.find((a) => a.startsWith(`${name}=`))
    if (eq) return eq.slice(name.length + 1)
    const i = args.indexOf(name)
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")
      ? args[i + 1]
      : undefined
  }
  return {
    repo: get("--repo"),
    apiKey: get("--api-key"),
    claudeToken: get("--claude-token"),
    githubToken: get("--github-token"),
    dryRun: args.includes("--dry-run"),
    yes: args.includes("--yes"),
  }
}

async function resolveCred(opts: {
  label: string
  envNames: string[]
  flag: string | undefined
  fallback?: () => string | undefined
  yes: boolean
  hint: string
}): Promise<string> {
  if (opts.flag) return opts.flag
  for (const name of opts.envNames) {
    const v = process.env[name]
    if (v) return v
  }
  const fb = opts.fallback?.()
  if (fb) return fb
  if (opts.yes) {
    fail(
      `missing ${opts.label}. Set one of ${opts.envNames.join(" / ")} or pass the flag. ${opts.hint}`,
    )
  }
  return promptHidden(`  ${opts.label}: `)
}

// --- steps -----------------------------------------------------------------

async function upsertSecret(
  name: string,
  value: string,
  create: () => Promise<Secret>,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    c.ok(`would create/rotate Superserve secret "${name}"`)
    return
  }
  const existing = await Secret.list()
  if (existing.some((s) => s.name === name)) {
    const secret = await Secret.get(name)
    await secret.rotate(value)
    c.ok(`rotated existing Superserve secret "${name}"`)
  } else {
    await create()
    c.ok(`created Superserve secret "${name}"`)
  }
}

/** Copy the loop runtime into `<repo>/.superserve/loops/`. */
function vendorRuntime(repoRoot: string, dryRun: boolean): string {
  const dest = join(repoRoot, ".superserve", "loops")
  const files: Array<[string, string]> = [
    ["../lib/run-loop.ts", "lib/run-loop.ts"],
    ["../pr-babysitter/loop.ts", "pr-babysitter/loop.ts"],
    ["../pr-babysitter/skill/SKILL.md", "pr-babysitter/skill/SKILL.md"],
  ]
  const pkg = JSON.stringify(
    {
      name: "superserve-loops-vendored",
      private: true,
      type: "module",
      dependencies: { "@superserve/sdk": SDK_VERSION },
    },
    null,
    2,
  )
  if (dryRun) {
    c.ok(
      `would vendor runtime into ${dest}/ (${files.length} files + package.json)`,
    )
    return dest
  }
  for (const [from, to] of files) {
    const body = readFileSync(new URL(from, import.meta.url), "utf8")
    const target = join(dest, to)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body)
  }
  writeFileSync(join(dest, "package.json"), `${pkg}\n`)
  c.ok(`vendored runtime into ${dest}/`)
  return dest
}

const WORKFLOW = `# Installed by \`superserve-loops add pr-babysitter\`. Wakes every 15 min, runs one
# PR Babysitter tick against a warm Superserve sandbox, and exits. Tune the cron freely.
name: loop-pr-babysitter
on:
  schedule:
    - cron: "*/15 * * * 1-5"
  workflow_dispatch: {}
concurrency:
  group: loop-pr-babysitter
  cancel-in-progress: false
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
        working-directory: .superserve/loops
      - run: bun run pr-babysitter/loop.ts --repo "\${{ github.repository }}" --once
        working-directory: .superserve/loops
        env:
          SUPERSERVE_API_KEY: \${{ secrets.SUPERSERVE_API_KEY }}
          SUPERSERVE_CLAUDE_SECRET: ${CLAUDE_SECRET}
          SUPERSERVE_GITHUB_SECRET: ${GITHUB_SECRET}
`

function writeWorkflow(repoRoot: string, dryRun: boolean): string {
  const path = join(repoRoot, ".github", "workflows", "loop-pr-babysitter.yml")
  if (dryRun) {
    c.ok(`would write ${path}`)
    return path
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, WORKFLOW)
  c.ok(`wrote ${path}`)
  return path
}

function setActionsSecret(
  repo: string,
  apiKey: string,
  githubToken: string,
  dryRun: boolean,
): void {
  if (dryRun) {
    c.ok(`would set GitHub Actions secret SUPERSERVE_API_KEY on ${repo}`)
    return
  }
  if (!tryExec("gh", ["--version"])) {
    c.warn("gh CLI not found — set the Actions secret manually:")
    c.info(
      `echo '<your SUPERSERVE_API_KEY>' | gh secret set SUPERSERVE_API_KEY --repo ${repo}`,
    )
    return
  }
  try {
    // Value comes via stdin so it never lands on the process argv list.
    execFileSync(
      "gh",
      ["secret", "set", "SUPERSERVE_API_KEY", "--repo", repo],
      {
        input: apiKey,
        env: { ...process.env, GH_TOKEN: githubToken },
        stdio: ["pipe", "ignore", "pipe"],
      },
    )
    c.ok(`set GitHub Actions secret SUPERSERVE_API_KEY on ${repo}`)
  } catch (err) {
    c.warn(
      `could not set the Actions secret automatically (${(err as Error).message.split("\n")[0]}).`,
    )
    c.info(
      `echo '<your SUPERSERVE_API_KEY>' | gh secret set SUPERSERVE_API_KEY --repo ${repo}`,
    )
  }
}

// --- main ------------------------------------------------------------------

const HELP = `superserve-loops — install agent loops into a repo

Usage:
  superserve-loops add pr-babysitter [options]

Options:
  --repo owner/name      Target repo (default: detected from the git remote)
  --api-key <key>        Superserve API key (or env SUPERSERVE_API_KEY)
  --claude-token <tok>   Claude subscription token from \`claude setup-token\` (or env CLAUDE_CODE_OAUTH_TOKEN)
  --github-token <tok>   GitHub PAT, repo scope (or env GITHUB_TOKEN / \`gh auth token\`)
  --yes                  Non-interactive (fail instead of prompting)
  --dry-run              Show what would happen; change nothing
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP)
    return
  }
  const [command, loop] = argv
  if (command !== "add") {
    fail(
      `unknown command "${command}". Try: superserve-loops add pr-babysitter`,
    )
  }
  if (loop !== "pr-babysitter") {
    fail(`unknown loop "${loop ?? ""}". Available: pr-babysitter`)
  }

  const flags = parseFlags(argv)
  const repo = detectRepo(flags.repo)
  const repoRoot =
    tryExec("git", ["rev-parse", "--show-toplevel"]) ?? process.cwd()

  console.log(
    `\nInstalling \x1b[1mpr-babysitter\x1b[0m into \x1b[1m${repo}\x1b[0m${flags.dryRun ? " (dry run)" : ""}\n`,
  )
  if (!flags.dryRun) {
    console.log(
      "Provide credentials (turned into Superserve secrets — never committed):",
    )
  }

  const apiKey = flags.dryRun
    ? (flags.apiKey ?? process.env.SUPERSERVE_API_KEY ?? "<api-key>")
    : await resolveCred({
        label: "Superserve API key",
        envNames: ["SUPERSERVE_API_KEY"],
        flag: flags.apiKey,
        yes: flags.yes,
        hint: "Get one at https://console.superserve.ai.",
      })
  const claudeToken = flags.dryRun
    ? "<claude-token>"
    : await resolveCred({
        label: "Claude subscription token (run `claude setup-token`)",
        envNames: ["CLAUDE_CODE_OAUTH_TOKEN"],
        flag: flags.claudeToken,
        yes: flags.yes,
        hint: "Generate it with `claude setup-token` (needs a Pro/Max/Team/Enterprise plan).",
      })
  const githubToken = flags.dryRun
    ? "<github-token>"
    : await resolveCred({
        label: "GitHub token (repo scope)",
        envNames: ["GITHUB_TOKEN", "GH_TOKEN"],
        flag: flags.githubToken,
        fallback: () => tryExec("gh", ["auth", "token"]),
        yes: flags.yes,
        hint: "Create a PAT with repo scope, or run `gh auth login`.",
      })

  c.step("1/4  Superserve secrets")
  process.env.SUPERSERVE_API_KEY = apiKey // used by the SDK for Secret.* calls
  await upsertSecret(
    CLAUDE_SECRET,
    claudeToken,
    () =>
      Secret.create({
        name: CLAUDE_SECRET,
        value: claudeToken,
        auth: { type: "bearer" },
        hosts: ["api.anthropic.com"],
      }),
    flags.dryRun,
  )
  await upsertSecret(
    GITHUB_SECRET,
    githubToken,
    () =>
      Secret.create({
        name: GITHUB_SECRET,
        value: githubToken,
        provider: "github",
      }),
    flags.dryRun,
  )

  c.step("2/4  Vendor the loop runtime")
  vendorRuntime(repoRoot, flags.dryRun)

  c.step("3/4  GitHub Actions workflow")
  writeWorkflow(repoRoot, flags.dryRun)

  c.step("4/4  GitHub Actions secret")
  setActionsSecret(repo, apiKey, githubToken, flags.dryRun)

  c.step(
    flags.dryRun
      ? "Dry run complete — nothing changed."
      : "Done. Commit + push to go live:",
  )
  if (!flags.dryRun) {
    c.info(
      "git add .github .superserve && git commit -m 'add pr-babysitter loop' && git push",
    )
    c.info(
      `gh workflow run loop-pr-babysitter.yml --repo ${repo}   # trigger the first run now`,
    )
    c.info("Your PRs will then be babysat every 15 minutes.")
  }
}

if ((import.meta as { main?: boolean }).main) {
  void main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
