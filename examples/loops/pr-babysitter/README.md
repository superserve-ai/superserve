# PR Babysitter

Shepherd open pull requests toward merge — without a human babysitting them — by running
**Claude Code headless inside a warm Superserve sandbox** on a schedule.

Each tick the loop discovers open PRs, reviews every new commit against a calibrated rubric, runs
the project's own checks as a verifier, posts **one** concise signed review, and **escalates** risky
PRs to a human. It **proposes**; a human merges. It never merges, force-pushes, or edits CI.

## Why a sandbox (and not just a GitHub Action)

- **Warm checkout at high cadence.** A 15-min Action re-clones + re-installs every run. Here the
  repo + deps are cloned _once_ on first create; every later tick resumes warm (`setup` is skipped).
- **Isolation for untrusted code.** A PR diff is untrusted input. Claude Code reviews and runs it
  inside a Firecracker microVM with `git worktree` isolation — never on your host or CI runner.
- **~$0 idle.** The box is paused between ticks.

The brain is Claude Code, driven by the [`pr-babysitter` skill](./skill/SKILL.md) (review rubric
ported from [`reviewd`](https://github.com/simion/reviewd), MIT). State lives in the box at
`/home/user/repo/.pr-babysitter-state.md`, deduped by PR head SHA.

## Install into a repo (one command)

```bash
# run inside the repo you want babysat
bunx @superserve/loops add pr-babysitter
```

It detects the repo and prompts for three credentials (entered without echo) — your Superserve API
key, a Claude subscription token (`claude setup-token`), and a GitHub PAT — then does everything:
creates the two Superserve secrets, vendors the runtime into `.superserve/loops/`, writes
`.github/workflows/loop-pr-babysitter.yml`, and sets the `SUPERSERVE_API_KEY` Actions secret. Push,
and it runs every 15 minutes.

```bash
# non-interactive (CI): pass tokens via env
SUPERSERVE_API_KEY=… CLAUDE_CODE_OAUTH_TOKEN=… GITHUB_TOKEN=… \
  bunx @superserve/loops add pr-babysitter --yes
# preview without changing anything
bunx @superserve/loops add pr-babysitter --dry-run
```

> In this monorepo (pre-publish), run it as `bun run examples/loops/install/cli.ts add pr-babysitter`.

The rest of this page is the **manual** setup the installer automates, plus how to run a tick locally.

## Setup (one-time)

1. **Generate a Claude subscription token** on a machine with a browser:
   ```bash
   claude setup-token        # requires a Pro/Max/Team/Enterprise plan; prints a ~1-year token
   ```
2. **Create two Superserve secrets** (console → https://console.superserve.ai/secrets, or the SDK):
   ```ts
   import { Secret } from "@superserve/sdk"
   // The OAuth token is sent as `Authorization: Bearer` to Anthropic — bind it with a custom
   // auth config scoped to Anthropic's hosts so it's swapped in at egress and never seen by the box.
   await Secret.create({
     name: "claude-oauth",
     value: process.env.CLAUDE_CODE_OAUTH_TOKEN!,
     auth: { type: "bearer" }, // Authorization: Bearer <token>
     hosts: ["api.anthropic.com", "claude.ai"],
   })
   await Secret.create({
     name: "loop-github-token",
     value: process.env.GH_PAT!,
     provider: "github",
   })
   ```
3. **Set `SUPERSERVE_API_KEY`** in your environment (and as a GitHub Actions secret for the cron).

## Run

```bash
# Inspect the resolved plan without creating a sandbox (no keys needed):
bun run pr-babysitter/loop.ts --repo owner/name --dry-run

# One live tick (needs SUPERSERVE_API_KEY + the two secret names below):
SUPERSERVE_API_KEY=ss_live_… \
SUPERSERVE_CLAUDE_SECRET=claude-oauth \
SUPERSERVE_GITHUB_SECRET=loop-github-token \
  bun run pr-babysitter/loop.ts --repo owner/name

# Local watch loop (dev): every 15 min
bun run pr-babysitter/loop.ts --repo owner/name --watch=15m
```

For dev without Superserve secrets, you can pass raw tokens instead (they then live in the box):
`CLAUDE_CODE_OAUTH_TOKEN=… GITHUB_TOKEN=… bun run pr-babysitter/loop.ts --repo owner/name`.

## Schedule it

Copy [`workflow.yml`](./workflow.yml) into `.github/workflows/` of the repo you want babysat — it
wakes every 15 min, runs one tick, and exits. Only `SUPERSERVE_API_KEY` is a GitHub secret; the
Superserve secret _names_ are plain env. For tighter than ~15-min cadence, run the same orchestrator
on Cloudflare Workers Cron instead (the SDK is `fetch`-based and runs at the edge).

## Safety

- **Never merges, force-pushes, or edits `.github/workflows`.** Strongest action is a review +
  `ready-to-merge` label.
- **Human gates:** security / auth / payments / core-infra changes, unresolved MUST_FIX, or a PR
  stuck across several runs → `@`-mention + `needs-human` label, no auto-action.
- **Prompt-injection firewall:** PR content is treated as data; the skill refuses instructions
  embedded in code/comments and only runs the project's own checks (read from the default branch).
- **Secrets** are bound via Superserve secret-binding — the real OAuth token / PAT never enter the
  box; a proxy token is swapped in at egress.

## How it maps to the loop-engineering primitives

| Primitive      | Here                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| Scheduling     | GitHub Actions cron (the heartbeat)                                        |
| Memory / State | `.pr-babysitter-state.md` in the warm box, deduped by head SHA             |
| Worktrees      | `git worktree` **inside** the microVM (branch + host isolation)            |
| Sub-agents     | maker (review) / checker (run the project's tests) split                   |
| Skills         | [`skill/SKILL.md`](./skill/SKILL.md), discovered by Claude Code in the box |
| Connectors     | `gh` CLI in the box (swap for the GitHub MCP server if you prefer)         |
