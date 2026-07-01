# Installing PR Superloop

A step-by-step guide, from "just try it" to "a branded bot with your own skills."

Each section is tagged so you can stop wherever it's enough for you:

- **Required** — you need this to run at all.
- **Optional** — a nicer experience, skip if you don't care.
- **Personalization** — make the bot look/behave like _yours_, no code.
- **Advanced** — deeper changes that mean running the loop from source.

The mental model: the loop is a tiny orchestrator that drives a **warm Superserve
sandbox** where **Claude Code** does the actual PR review. "Running it" — locally or
in CI — only means running that orchestrator; the review always happens in the cloud
sandbox. So a real run always needs a Superserve API key + a Claude credential; only
`--dry-run` needs nothing.

---

## Prerequisites — Required

| You need                             | Where to get it                                                                          | Notes                                                                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Superserve API key** (`ss_live_…`) | [console.superserve.ai](https://console.superserve.ai)                                   | The account that runs the sandbox.                                                                                                                                                                     |
| **A Claude credential**              | `claude setup-token` (subscription, ~1-yr token) **or** an `ANTHROPIC_API_KEY` (metered) | Subscription keeps most ticks off the metered bill.                                                                                                                                                    |
| **bun**                              | [bun.sh](https://bun.sh)                                                                 | Only to run the installer / a local tick.                                                                                                                                                              |
| **GitHub access**                    | —                                                                                        | **Nothing extra** for reviewing the same repo the workflow lives in — it uses the built-in Actions token. A PAT or your own GitHub App is only for a _different_ repo or a _branded_ identity (below). |

---

## 1. Try it locally — Optional (recommended first)

No commit, no repo changes. Great for seeing the resolved plan and one live review.

```bash
# Preview only — creates nothing, needs no keys:
bunx @superserve/loops run pr-superloop --repo owner/name --dry-run

# One real tick from your machine (needs your keys). The orchestrator runs here;
# the review runs in a Superserve cloud sandbox.
SUPERSERVE_API_KEY=ss_live_… \
CLAUDE_CODE_OAUTH_TOKEN=… \
GITHUB_TOKEN=$(gh auth token) \
  bunx @superserve/loops run pr-superloop --repo owner/name --pr 42
```

- Swap `CLAUDE_CODE_OAUTH_TOKEN=…` for `ANTHROPIC_API_KEY=…` to use metered billing.
- `--repo` is optional — it defaults to the current checkout's `github.com` remote.
- `--pr N` focuses one PR; omit it to sweep every open PR in one tick.
- Add `--watch=15m` to re-tick on an interval instead of exiting (local dev loop).

---

## 2. Install it into a repo — Required (to actually deploy)

Run this **inside the repo you want reviewed**:

```bash
bunx @superserve/loops add pr-superloop
```

It does everything for you:

1. Mints your Claude token (runs `claude setup-token` if you don't have one) and stores
   it as a **Superserve secret** (`claude-oauth`) — egress-swapped, never in your repo.
2. Sets `SUPERSERVE_API_KEY` as a **GitHub Actions secret** on the repo.
3. Writes `.github/workflows/loop-pr-superloop.yml` (the _only_ file added to your repo).

Then:

```bash
git add .github/workflows/loop-pr-superloop.yml
git commit -m "add pr-superloop" && git push
```

That's it. Every commit pushed to a PR triggers one warm-sandbox tick that reviews it.
By default the bot posts as **`github-actions[bot]`** — no GitHub PAT, nothing else to set up.

<details>
<summary>Non-interactive / other flags</summary>

```bash
# CI / non-interactive — pass tokens via env:
SUPERSERVE_API_KEY=… CLAUDE_CODE_OAUTH_TOKEN=… \
  bunx @superserve/loops add pr-superloop --yes

# Preview without changing anything:
bunx @superserve/loops add pr-superloop --dry-run

# Review a DIFFERENT repo, or post under a machine-user identity → opt into a PAT:
bunx @superserve/loops add pr-superloop --github-token <PAT>
```

</details>

---

## 3. Give it a branded avatar — Optional · Personalization

By default reviews come from `github-actions[bot]` with GitHub's generic icon. To make
the bot post under **your own name and profile picture**, give it its own **GitHub App**.

> **Why your own App, not a shared one?** An App's private key is the master credential
> for every place it's installed. Keeping the App — and its key — **yours**, in your own
> repo, means nothing is shared and there's nothing for anyone else to compromise. That's
> the whole self-serve model: your bot, your key, your identity.

**One-time, on GitHub:**

1. **Create the App** — `Settings → Developer settings → GitHub Apps → New GitHub App`:
   - **Name** → becomes the handle (e.g. `acme-pr-loop` → `acme-pr-loop[bot]`).
   - **Homepage URL** → anything (your repo is fine).
   - **Webhook → uncheck "Active"** (this bot is driven by your workflow, not webhooks).
   - **Permissions**: `Contents: Read-only`, `Pull requests: Read & write`, `Issues: Read & write` (labels).
   - Create → note the **App ID** → **Generate a private key** (downloads a `.pem`).
2. **Avatar** → the App's **Display information → upload a logo**. This is the profile picture.
3. **Install** the App on the repo you're reviewing.

**Then wire it in (once), from a checkout of that repo:**

```bash
gh secret set LOOP_APP_ID --body "<your App ID>"
gh secret set LOOP_APP_PRIVATE_KEY < ~/Downloads/your-app.*.private-key.pem
```

Edit `.github/workflows/loop-pr-superloop.yml` — add the token-mint step and point the
loop at it:

```yaml
steps:
  - uses: oven-sh/setup-bun@v2
  - uses: actions/create-github-app-token@v1 # official; check for the latest major
    id: app-token
    with:
      app-id: ${{ secrets.LOOP_APP_ID }}
      private-key: ${{ secrets.LOOP_APP_PRIVATE_KEY }}
  - run: bunx @superserve/loops@stable run pr-superloop --repo "${{ github.repository }}" --pr "${{ github.event.pull_request.number }}" --once
    env:
      SUPERSERVE_API_KEY: ${{ secrets.SUPERSERVE_API_KEY }}
      SUPERSERVE_CLAUDE_SECRET: claude-oauth
      GITHUB_TOKEN: ${{ steps.app-token.outputs.token }} # was ${{ github.token }}
```

Now reviews post as **`your-app[bot]`** with your avatar. The private key never leaves
your repo's secrets, and the token minted each run is scoped to this one repo for an hour.

> A one-command `--github-app` installer (GitHub's App-manifest flow → one click, key
> stored for you) is on the roadmap. For now these steps are manual.

---

## 4. Make it review _your_ way — Personalization (no code)

These work with the published loop as-is — nothing to fork.

- **Review norms & the merge bar.** Each run the loop reads your repo's `CLAUDE.md` /
  `AGENTS.md` / `README.md` for the review conventions and what "ready to merge" means
  _here_. Write your team's rules there and reviews follow them.
- **The verifier's checks.** The loop runs your project's _own_ tests / lint / build
  (discovered from `CLAUDE.md`/`AGENTS.md`/`Makefile`/CI on the default branch). Keep
  them defined the normal way — nothing loop-specific.
- **Add your own skills.** Commit them to your repo at `.claude/skills/<name>/SKILL.md`.
  Claude Code runs _inside your cloned repo_, so it discovers project skills automatically
  — no upload step.
  > **Caveat:** a repo skill can only use tools the loop already allows — `gh`, `git`,
  > the common package managers (`npm`/`npx`/`node`/`bun`/`pnpm`/`yarn`), `make`, the
  > common test runners (`pytest`/`python3`/`go`/`cargo`), and `Read`/`Edit`/`Write`/
  > `Glob`/`Grep`. A skill that needs a _new_ command or tool needs the Advanced path.

---

## 5. Deeper changes — Advanced (run from source)

The loop's code ships as the `@superserve/loops` package (your workflow just `bunx`es it),
so changing its _behavior_ means running your own copy: fork/clone `examples/loops`, edit,
then either run it locally (`bun run pr-superloop/loop.ts …`) or, in the workflow, replace
the `bunx @superserve/loops@stable …` line with a checkout of your fork + `bun run`.

Knobs live in [`pr-superloop/loop.ts`](./loop.ts) (sandbox template, model / `--max-turns`,
the tool allow/deny lists, watch interval) and the review rubric itself is
[`skill/SKILL.md`](./skill/SKILL.md).

### Add your own MCP servers — Advanced

Giving the reviewer an MCP server (e.g. a Jira, Sentry, or database MCP) has three parts,
and the third is why it needs the from-source path today:

1. **Config** — add a project [`.mcp.json`](https://modelcontextprotocol.io) to your repo
   (Claude Code picks up project MCP servers from the repo it runs in).
2. **Secrets** — bind any server API keys as Superserve secrets (egress-swapped) or env
   vars, so the server can authenticate from inside the box.
3. **Tool policy** — allow the server's `mcp__<server>__*` tools in the loop's
   `--allowedTools` list. That list lives in `pr-superloop/loop.ts`, not your repo, so
   enabling MCP means running your edited copy of the loop.

> A built-in MCP passthrough (config + allow-list from the repo, no fork) is a candidate
> for a future release.

---

## Which key does what — Reference

| Name                                   | Kind                    | Purpose                            | Where it lives                                                            |
| -------------------------------------- | ----------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `SUPERSERVE_API_KEY`                   | secret                  | Create/drive the sandbox           | GitHub Actions secret (or local env)                                      |
| `claude-oauth` / `ANTHROPIC_API_KEY`   | Superserve secret / key | The Claude credential the box uses | Superserve secret (subscription) or env (metered)                         |
| `GITHUB_TOKEN`                         | token                   | Clone the repo + post the review   | Built-in Actions token by default; App token or PAT if branded/cross-repo |
| `LOOP_APP_ID` / `LOOP_APP_PRIVATE_KEY` | secret                  | Mint the branded App's token       | GitHub Actions secrets (Section 3 only)                                   |

For how it triggers, cost, and the full safety model (never merges, prompt-injection
firewall, human gates), see the [README](./README.md).
