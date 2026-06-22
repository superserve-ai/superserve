# Cloud Coding Agents — Linear Backlog (DRAFT for review)

**Status:** DRAFT — do not push to Linear until approved.
**Date:** 2026-06-16
**Parent epic:** SS-78 "Superserve's cloud coding agents"
**Related:** [`2026-06-16-cloud-coding-agents-market-research.md`](./2026-06-16-cloud-coding-agents-market-research.md)

---

## How it all fits together (read this first)

**What we're building, in one sentence:** a way to take a coding agent (like Claude Code), run it _inside a Superserve sandbox in the cloud_ instead of on a laptop, hand it a task, and get back a pull request — and to kick that off ("summon" it) from your editor, a GitHub issue, a Linear issue, or a Slack message.

**The two halves of the work:**

1. **The spine** — the shared machinery that takes _"a repo + a task"_ and produces _"a reviewable PR."_ It boots a sandbox, runs the agent inside it, and pushes a branch. Built once, reused by every trigger. (Phase 0.)
2. **The triggers** — the different "front doors" people use to start a run: from a local editor, or by @mentioning / assigning the agent in GitHub, Linear, or Slack. Each trigger is a thin adapter on top of the spine. (Phases 1–3.)

**One run, end to end (how the pieces connect):**

1. A **trigger** fires — e.g. you @mention the bot on a GitHub issue, or call it from Claude Code.
2. The **orchestrator** (the server-side conductor) books a sandbox from a prebuilt **template**, injects the needed secrets, and starts the **runner**.
3. The **runner** is a small program _inside_ the sandbox that launches the actual coding agent (the **harness**, e.g. Claude Code), gives it the task, and streams progress back out.
4. When the agent finishes, the **repo I/O** step commits its changes to a branch and opens a draft **pull request**.
5. Status + the PR link flow back to wherever you summoned it, and you can watch the whole thing live in the **console**.

**Glossary (the words that show up in every ticket):**

| Term                   | Plain meaning                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloud coding agent** | A normal coding agent running in a Superserve sandbox in the cloud, not on your machine.                                                              |
| **Harness**            | The agent program itself — Claude Code, Codex, opencode. We run _whichever one you pick_; we don't build the agent's "brain."                         |
| **Harness-agnostic**   | Not locked to one harness, so we can add Codex/opencode later without a rewrite.                                                                      |
| **Runner**             | The tiny wrapper we put inside the sandbox that starts the harness and reports progress. (A rough version already exists in `guides/managed-agents`.) |
| **Orchestrator**       | The server-side engine that turns a request into a running sandbox + runner and tracks its lifecycle.                                                 |
| **Spawn primitive**    | The single reusable "start a run" action every trigger calls — one SDK method / CLI command / MCP tool.                                               |
| **Summon**             | Start a run from an outside surface (GitHub/Linear/Slack) by assigning or @mentioning the agent.                                                      |
| **BYOK**               | "Bring your own key" — the customer supplies their own model API key, so runs use their model access and bill to them.                                |
| **PR-as-output**       | The agent's work always lands as a reviewable pull request — never auto-merged, never loose files.                                                    |
| **MCP**                | Model Context Protocol — the standard way local agents (Claude Code, Cursor) call external tools. How "local spawns cloud" works.                     |

---

## Assumptions baked into this backlog (redirect if wrong)

- **Shape = B1** — _summon layer + agent runtime, bring-your-own-harness._ Superserve provides the spawn primitive, run lifecycle, and summon surfaces; the customer brings the harness + model key. Not a branded "Superserve Agent."
- **MVP = the spine + local-spawn (MCP/CLI).** GitHub summon is the first SaaS surface, immediately after. Linear + Slack reuse the same spine.
- **First harness = Claude Code**, runner kept harness-agnostic so Codex / opencode slot in later.
- **First repo provider = GitHub** (GitLab/Bitbucket deferred).
- **Customer-facing & multi-tenant** — team-scoped (reuses existing API-key→team mapping + Supabase RLS).

## Home in Linear: sub-issues of SS-78

Verified via the API on 2026-06-16:

- **Team:** `SS / Superserve` (only team). **No Linear projects exist** (0 workspace-wide, incl. archived) and cycles are off — the team uses a flat issue list with parent/sub-issues.
- **Parent epic already exists: SS-78 "Superserve's cloud coding agents"** — its body is the original two-bullet brief. **Plan: make every net-new ticket below a sub-issue of SS-78** (no new project, to match current workflow — unless you'd prefer a `Cloud Coding Agents` project).
- **Assignee:** you (@mohamed) on all, per your note.
- **Labels available:** `Feature`, `Improvement`, `Chore`, `Build`, `Platform`, `Product`, `Bug`, `good-first-issue`. No `cloud-agents` label exists — recommend creating one to group the set; type via `Feature`/`Chore`/`Platform`.
- **Estimates:** Fibonacci points (1/2/3/5/8). **Priority** uses Linear's scale (1 Urgent → 4 Low).

## Reconciliation with existing Linear issues (de-dup)

| Draft                        | Existing issue                                             | Decision                                                                                                |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| P0-5 BYOK secrets            | **SS-50** Credentials proxy / broker (In Progress, @amit1) | **Reuse SS-50** — reframe P0-5 as "inject agent secrets via the SS-50 broker"; depends on SS-50.        |
| P1-4 MCP spawn tool          | **SS-84** Superserve MCP server (`@superserve/mcp`)        | **Extend SS-84** — add `spawn_cloud_agent` + run tools to that server; don't build a second MCP server. |
| X-1 usage metering           | **SS-55** Usage tracking and Billing (@alejandro)          | **Drop X-1** — add a note/sub-task on SS-55 so agent runs emit vCPU/mem/storage.                        |
| X-4 pricing spike            | **SS-55 / SS-44** Billing                                  | **Drop X-4** — fold into existing billing tickets.                                                      |
| Harness integrations (later) | **SS-80, SS-83, SS-85-87**                                 | Adjacent, not dup — Claude Code adapter (P0-2) is net-new.                                              |
| P1-6 GitHub App              | **SS-8** Oauth with github (Done)                          | Distinct — App install tokens + webhooks ≠ the existing OAuth; may reuse groundwork.                    |

**Net-new sub-issues to create under SS-78:** P0-1..P0-4, P0-5 (reframed), P1-1..P1-3, P1-4 (extends SS-84), P1-5, P1-6, P2-1..P2-3, P3-1, P3-2, X-2, X-3 — **18 tickets**.

---

## Phase 0 — Spine (MVP foundations)

> The spine is the reusable path _repo + task → PR_. Nothing user-facing yet; this is the engine every trigger plugs into.

### [P0-1] Agent-run domain model + data model & migrations

- **Type:** Feature · **Priority:** 1 (Urgent) · **Estimate:** 3 · **Labels:** `cloud-agents`, `Platform` · **Depends on:** —

**Why.** Everything in this epic revolves around one new concept: an **agent run** — a single instance of "an agent worked on a repo and produced a PR." Before building any trigger or UI, we have to agree on what a run _is_: the data we store and the sequence of states it moves through. If we skip this, every other ticket invents its own version and they won't fit together. This is the shared vocabulary the whole feature speaks.

**What to build.** Define the `AgentRun` record and a strict **state machine** (`queued → provisioning → cloning → running → (paused) → awaiting_review → succeeded | failed | cancelled`), then create the tables. A run stores: repo + branch, the task text, which harness ran, the sandbox id, the resulting PR URL, who started it and from where (CLI/GitHub/Linear/Slack), timing, and the outcome. A companion `agent_run_events` table stores the timeline (status changes + log lines) so the console and summon surfaces can show live progress. Team-scoped with Supabase **RLS** so one customer can never see another's runs.

**Example.** A row reads: _run `abc123`, repo `acme/api`, task "fix flaky login test", harness `claude-code`, state `succeeded`, PR `.../pull/42`, started_by `mohamed` via CLI._

**Acceptance criteria**

- [ ] State machine documented (allowed transitions + terminal states) and reviewed.
- [ ] Supabase migrations for `agent_runs` + `agent_run_events`, team-scoped RLS.
- [ ] TypeScript types added to `apps/console/src/lib/api/types.ts`, matching the OpenAPI spec.
- [ ] "Agent made no code changes" is a distinct, representable outcome (not a failure).
- [ ] An RLS test proves cross-team reads are blocked.

### [P0-2] Harness-agnostic in-VM runner + Claude Code adapter + template

- **Type:** Feature · **Priority:** 2 (High) · **Estimate:** 5 · **Labels:** `cloud-agents`, `Platform` · **Depends on:** P0-1

**Why.** A "cloud coding agent" is just a normal coding agent (Claude Code, Codex, …) running _inside_ a Superserve sandbox. The **runner** is the small program we put inside the sandbox that launches that agent, hands it the task, and streams progress back out. We want it **harness-agnostic** so we're not betting the product on one vendor — Claude Code today, Codex tomorrow, without a rewrite. A rough version already exists in `guides/managed-agents`; this turns that prototype into a real, reusable component.

**What to build.** A small `Runner` interface — _"given a task, a checked-out repo, and a model key, run the agent and emit structured events (`started`, `tool_use`, `progress`, `completed`, `error`)."_ Implement the **Claude Code adapter** first behind that interface. Build a Superserve **template** (a prebuilt sandbox image, via the existing `Template.create` flow) with the agent + git + tooling preinstalled, so runs boot in under a second instead of installing things each time.

**Example.** The orchestrator drops the runner into a fresh sandbox and starts it; the runner prints one JSON event per line, which the orchestrator ingests into the run timeline.

**Acceptance criteria**

- [ ] `Runner` interface defined; Claude Code adapter implemented behind it.
- [ ] Template image builds with harness + git preinstalled; boots ready-to-run.
- [ ] Runner emits the documented event stream consumed by the orchestrator (P0-4).
- [ ] Exit status maps cleanly to `succeeded` / `failed` / `no-changes`.
- [ ] Runs end-to-end against a sample repo + task in a throwaway sandbox.

### [P0-3] Repo I/O: clone → branch → commit → open PR (GitHub)

- **Type:** Feature · **Priority:** 2 (High) · **Estimate:** 5 · **Labels:** `cloud-agents`, `Platform` · **Depends on:** P0-1

**Why.** The whole point of a run is to produce a **pull request** a human reviews — never an auto-merge, never loose files. This ticket is the Git plumbing around the agent's work: get the code in, let the agent change it, turn those changes into a clean PR linked back to where the work was requested. It's separate from the agent because every trigger and every harness needs the exact same Git behavior.

**What to build.** Authenticate to GitHub with a **GitHub App installation token** (short-lived, repo-scoped — safer than a personal token sitting in a sandbox; the App itself comes from P1-6). Shallow-clone the repo into the sandbox, create a predictably-named work branch, and after the run: commit, push, and open a **draft PR** with an agent-written title + summary. Handle "agent changed nothing" gracefully — no empty PRs.

**Example.** Branch `superserve/agent/abc123` is pushed and draft PR "Fix flaky login test" opens against `main` with a summary of the change.

**Acceptance criteria**

- [ ] Authenticated clone via GitHub App installation token (no long-lived PAT in the sandbox).
- [ ] Deterministic branch naming (`superserve/agent/<run-id>`).
- [ ] Commit + push + open draft PR; PR URL saved on the run.
- [ ] No-changes run finishes cleanly without opening a PR.
- [ ] Auth/push failures surface as typed run failures, not silent errors.

### [P0-4] Orchestrator: the spawn-primitive run engine

- **Type:** Feature · **Priority:** 2 (High) · **Estimate:** 8 · **Labels:** `cloud-agents`, `Platform` · **Depends on:** P0-1, P0-2, P0-3, P0-5

**Why.** This is the **conductor** that ties P0-1/2/3 together — the single server-side engine that turns a request ("run agent on this repo with this task") into a real, tracked run. Every front door (CLI, MCP tool, the GitHub/Linear/Slack adapters) calls into _this one engine_ instead of each re-implementing "boot a sandbox, start the agent, watch it, make a PR." That's what **"spawn primitive"** means: one reusable action to start a run. It's the most central — and riskiest — ticket; getting it right is what keeps the whole feature consistent.

**What to build.** A run engine that: accepts a request; books a sandbox from the P0-2 template; injects secrets (P0-5); starts the runner; ingests the runner's events into the run timeline (P0-1); enforces the state machine; supports pause/resume (reusing Superserve's existing sandbox pause/resume); calls the P0-3 step to finalize the PR; then cleans up the sandbox. One internal API all entry points share.

**Example.** The CLI and a GitHub webhook both hit the same `start run` API; the engine handles them identically and they appear side by side in the console.

**Acceptance criteria**

- [ ] One internal API to start / observe / cancel a run; all entry points use it (no duplicate logic).
- [ ] Provisions sandbox from template, injects secrets, starts runner.
- [ ] Persists runner events to the timeline; enforces P0-1 state transitions.
- [ ] On completion, triggers P0-3 to open the PR and records the URL; cleans up the sandbox.
- [ ] Concurrent runs are fully isolated (no shared/leaked state).

### [P0-5] Agent-run secret injection via the credentials broker (SS-50)

- **Type:** Feature · **Priority:** 2 (High) · **Estimate:** 2 · **Labels:** `cloud-agents`, `Platform` · **Depends on:** P0-1, **SS-50**

**Why.** A run needs two secrets the moment it starts: the customer's **model API key** (so the agent can call Claude/etc., billed to them — this is **BYOK**) and a **GitHub token** (so it can clone and open a PR). These must reach the sandbox _without_ ever hitting logs or leaking across tenants. Rather than build a new secret store, we reuse **SS-50 "Credentials proxy / broker"** (@amit1 is already building it) — this ticket just teaches it about these two secret types and wires them into a run.

**What to build.** Confirm SS-50 already does per-team encrypted storage + retrieval (it should). Then register the agent model key + GitHub App token as broker-managed secrets; at run-provision time fetch them and inject them as sandbox env vars; ensure they're scrubbed from all logs and the timeline. If SS-50 lacks something, file a scoped follow-up _on SS-50_ rather than building a parallel store here.

**Acceptance criteria**

- [ ] Model key + GitHub credentials resolved via the SS-50 broker (no second secret store).
- [ ] Injected as sandbox env at provision time; never appear in logs/timeline.
- [ ] Team-scoped; access audit-logged.
- [ ] Any broker gap filed as a follow-up on SS-50, not duplicated here.

---

## Phase 1 — Local-spawn MVP (MCP + CLI)

> The first usable product: a developer (or a local agent like Claude Code) starts a cloud run and gets a PR. This is the "local agents spawn cloud agents" goal, and the thing we can dogfood immediately.

### [P1-1] TypeScript SDK: `Agent.run()` + run handle

- **Type:** Feature · **Priority:** 2 (High) · **Estimate:** 3 · **Labels:** `cloud-agents`, `Feature` · **Depends on:** P0-4

**Why.** This is how a developer (or another program) starts a cloud agent from code — the public, friendly front door to the P0-4 engine in our TypeScript SDK. The CLI (P1-3) and the MCP tool (P1-4) are both built on it, so they all behave identically. Without it, customers can only hit raw HTTP.

**What to build.** Add `Agent.run({ repo, task, harness })` to `@superserve/sdk`, returning a **run handle** with `.status()`, `.logs()` (live stream), `.wait()`, `.cancel()`, and `.pr()` (the PR URL). Follow the SDK's existing conventions: readonly snapshots, `AbortSignal`, the typed error hierarchy, auto-retry on GET.

**Example.**

```ts
const run = await Agent.run({
  repo: "acme/api",
  task: "fix the flaky login test",
})
await run.wait()
console.log(await run.pr()) // → https://github.com/acme/api/pull/42
```

**Acceptance criteria**

- [ ] `Agent.run()` + handle methods implemented with typed errors.
- [ ] Log streaming uses idle-timeout semantics consistent with `commands.run`.
- [ ] Unit tests (no creds) + an e2e test gated on `SUPERSERVE_API_KEY`.
- [ ] SDK reference docs updated.

### [P1-2] Python SDK: `Agent.run()` parity (sync + async)

- **Type:** Feature · **Priority:** 2 (High) · **Estimate:** 3 · **Labels:** `cloud-agents`, `Feature` · **Depends on:** P0-4

**Why.** The same front door as P1-1, for Python users — a big share of AI/agent developers. The two SDKs are kept deliberately in sync (per RELEASING.md), so whatever TS can do, Python can too.

**What to build.** Add `run()` to both `Sandbox` (sync) and `AsyncSandbox` (async) in the `superserve` package, snake_case, mirroring the TS surface and the existing typed-error hierarchy (`SandboxTimeoutError`, etc.).

**Example.**

```python
run = sandbox.agent.run(repo="acme/api", task="fix the flaky login test")
run.wait()
print(run.pr())  # → https://github.com/acme/api/pull/42
```

**Acceptance criteria**

- [ ] Sync + async `run()` + handle parity with TS.
- [ ] pytest unit tests + a credentialed e2e test that skips cleanly without a key.
- [ ] ruff + mypy clean; reference docs updated.
- [ ] TS and Python versions kept in sync per RELEASING.md.

### [P1-3] CLI: `superserve agent run | status | logs | cancel`

- **Type:** Feature · **Priority:** 3 (Medium) · **Estimate:** 2 · **Labels:** `cloud-agents`, `Feature` · **Depends on:** P1-1

**Why.** The fastest way for a human to try the feature and the easiest thing to dogfood — no installs, no UI, just a terminal command in any repo. It wraps the SDK so behavior matches everything else.

**What to build.** CLI subcommands: `agent run` (start a run from the current repo + a task string), `agent logs <id>` (stream live progress), `agent status <id>`, `agent cancel <id>`. Print the PR link on success; non-zero exit on failure.

**Example.** `superserve agent run --task "add retry to the http client"` → streams progress → prints the PR URL when done.

**Acceptance criteria**

- [ ] `agent run` accepts repo (default: current dir), task, and `--harness`.
- [ ] `agent logs` streams live; `status` / `cancel` work by run id.
- [ ] PR URL printed on success; non-zero exit on failure.
- [ ] `--help` documented; consistent with existing CLI UX.

### [P1-4] Add `spawn_cloud_agent` tools to the Superserve MCP server (extends SS-84)

- **Type:** Feature · **Priority:** 2 (High) · **Estimate:** 3 · **Labels:** `cloud-agents`, `Feature` · **Depends on:** P1-1, **SS-84**

**Why.** This is the headline of goal #1: **"local coding agents should be able to spawn cloud coding agents."** MCP is the standard way local agents (Claude Code, Cursor) call external tools. By exposing a `spawn_cloud_agent` tool over MCP, a developer in Claude Code can say _"spin up a cloud agent to refactor this module"_ — the heavy work runs in a Superserve sandbox and comes back as a PR while their laptop stays free. We add this to the MCP server **already scoped in SS-84** (which exposes low-level sandbox tools), not a second server.

**What to build.** Add high-level tools to `@superserve/mcp`: `spawn_cloud_agent` (start a run: repo + task + harness), `get_run_status`, `get_run_logs`, `cancel_run`. Auth via the Superserve API key. They call the same P0-4 engine as everything else.

**Example.** In Claude Code: _"Use spawn_cloud_agent to fix the failing CI on branch X"_ → minutes later Claude Code reports back a PR link.

**Acceptance criteria**

- [ ] Spawn/status/logs/cancel tools added to the SS-84 server (one server, layered tools).
- [ ] Auth via `SUPERSERVE_API_KEY`; team-scoped.
- [ ] Verified from Claude Code (`.mcp.json`) end-to-end: prompt → cloud run → PR link.
- [ ] Documented alongside SS-84's MCP docs page.

### [P1-5] Console: Agent Runs list + detail view

- **Type:** Feature · **Priority:** 2 (High) · **Estimate:** 5 · **Labels:** `cloud-agents`, `Feature` · **Depends on:** P0-4

**Why.** People need to _see_ what their cloud agents are doing — a list of runs and a live view of any single one. This is the visual home of the feature in the dashboard: watch progress, read logs, grab the PR. Until it exists, runs are invisible unless you're staring at a CLI.

**What to build.** A new console section: a **runs list** (status, repo, task, PR link) and a **detail view** with a live-streaming log/timeline plus pause/resume/cancel controls + the PR link. Reuse the existing table, sticky-hover, web-terminal, and React Query patterns, and the console's austere design language (dashed borders, mono uppercase headers, mint = running, corner brackets on empty states).

**Acceptance criteria**

- [ ] Runs list with status chips + PR links; React Query via the centralized query keys.
- [ ] Detail view streams the timeline live; pause/resume/cancel wired with optimistic updates.
- [ ] Empty state with corner brackets; dashed borders; mono uppercase headers per design language.
- [ ] Responsive + accessible control labels.

### [P1-6] GitHub App: install + repo connection

- **Type:** Feature · **Priority:** 2 (High) · **Estimate:** 3 · **Labels:** `cloud-agents`, `Feature` · **Depends on:** P0-3

**Why.** Before any run can clone a repo or open a PR, Superserve needs _permission_ to that repo. The clean, standard way is a **GitHub App** the customer installs on their org/repo — it grants short-lived, scoped tokens (much safer than someone pasting a personal access token). This is different from the existing GitHub _OAuth sign-in_ (SS-8, done): OAuth identifies a user; the App grants repo access + webhooks. It underpins both local-spawn-with-PR and the GitHub summon surface (Phase 2).

**What to build.** Create the Superserve GitHub App with least-privilege permissions (`contents`, `pull_requests`, `issues`, `checks`). Build the console flow to install it and store the installation per team, plus a repo picker used when starting a run. Handle disconnect/uninstall; never expose tokens to the browser.

**Acceptance criteria**

- [ ] GitHub App created with least-privilege scopes.
- [ ] Install/callback flow stores the installation per team; repo picker in the spawn UI.
- [ ] Disconnect/uninstall handled; tokens never client-side.
- [ ] Connection state visible in console settings.

---

## Phase 2 — GitHub summon

> The first SaaS surface and the highest-value one: summon an agent straight from a GitHub issue, like Copilot's coding agent. Reuses the entire spine; adds GitHub-specific intake + feedback.

### [P2-1] GitHub summon: webhook intake + event routing

- **Type:** Feature · **Priority:** 3 (Medium) · **Estimate:** 3 · **Labels:** `cloud-agents`, `Feature` · **Depends on:** P1-6, P0-4

**Why.** Before we can react to "someone assigned the bot to an issue," we need to reliably _receive and understand_ GitHub's webhook events. This is the secure front-of-house for the GitHub surface: catch the events, verify they're genuinely from GitHub, and translate the relevant ones into run requests.

**What to build.** An endpoint that receives GitHub webhooks (issue assigned to our bot, `issue_comment` containing an @mention), verifies the HMAC signature, de-duplicates redelivered events, and routes qualifying ones into a P0-4 run request. Everything else returns 200 and no-ops.

**Acceptance criteria**

- [ ] HMAC signature verification; duplicate/replayed deliveries ignored.
- [ ] Issue-assigned and @mention events parsed into a normalized run request.
- [ ] Unhandled event types no-op with 200.
- [ ] Routing covered by tests with recorded fixtures.

### [P2-2] GitHub summon: assign / @mention → spawn → draft PR

- **Type:** Feature · **Priority:** 3 (Medium) · **Estimate:** 5 · **Labels:** `cloud-agents`, `Feature` · **Depends on:** P2-1

**Why.** This is the actual magic of the GitHub surface — the UX GitHub Copilot's coding agent popularized: assign an issue to the Superserve bot (or @mention it), and minutes later a draft PR appears that addresses it. It's the most natural place to summon an agent because the work item and the code live in the same place.

**What to build.** Wire P2-1's routed events into the P0-4 engine: use the issue title/body/comments as the task, run the agent, and open a draft PR cross-linked back to the issue. Respect per-team auth + rate limits; reject installs we don't recognize.

**Example.** Mohamed assigns issue #57 "Login flaky in CI" to `@superserve` → minutes later draft PR #58 opens, linked to #57.

**Acceptance criteria**

- [ ] Both assignment and @mention trigger a run with the issue as task context.
- [ ] Draft PR opened and cross-linked to the originating issue.
- [ ] Per-team auth + rate limits respected; unknown installs rejected.
- [ ] Demonstrated end-to-end on a test repo.

### [P2-3] GitHub summon: progress reporting (reactions, comments, check runs)

- **Type:** Feature · **Priority:** 3 (Medium) · **Estimate:** 3 · **Labels:** `cloud-agents`, `Feature` · **Depends on:** P2-2

**Why.** When you hand work to an agent on GitHub, you want to _see it working_ without leaving GitHub — an acknowledgement, live progress, a clear final result. This is what makes the summon feel responsive and trustworthy instead of a black box.

**What to build.** Map the runner's events to GitHub-native feedback: a 👀 reaction on trigger, a progress comment that updates as the run advances, a non-blocking **check run** (a status that never blocks merging), and a final summary comment with the PR link. On failure, post a comment explaining what went wrong.

**Acceptance criteria**

- [ ] 👀 acknowledgement within seconds of the trigger.
- [ ] Progress comment updates on key transitions; final summary on completion.
- [ ] Check run uses a `neutral` conclusion (never blocks merge).
- [ ] Failures reported back as a comment with a plain-language reason.

---

## Phase 3 — Linear + Slack summon

> Two more front doors, both thin adapters on the same spine. Linear is becoming the standard "assign work to an agent" surface; Slack is the lowest-friction "just ask" surface.

### [P3-1] Linear summon: agent app (actor=app OAuth + Agent Session)

- **Type:** Feature · **Priority:** 3 (Medium) · **Estimate:** 5 · **Labels:** `cloud-agents`, `Feature` · **Depends on:** P0-4, P0-3

**Why.** Linear added first-class support for AI agents: an agent shows up as a real workspace member you can **assign issues to** or **@mention**, and Linear drives a structured "Agent Session" conversation with it. This is fast becoming the standard "assign work to an agent" surface for engineering teams — and it's exactly goal #2 ("summon … in … Linear"). Because Linear built a purpose-made API for it, the integration is clean.

**What to build.** Register Superserve as a Linear agent using **`actor=app` OAuth** (actions attributed to the app, scopes `app:assignable` + `app:mentionable`). Handle the **Agent Session** webhook lifecycle: on assign/@mention, acknowledge fast (Linear expects an initial activity within seconds), start a P0-4 run using the issue as the task, post progress + the final PR link back into the session, and close it correctly. Handle the error / awaiting-input states.

**Acceptance criteria**

- [ ] `actor=app` OAuth install; installation id + token stored per team.
- [ ] Agent Session created on assign/@mention; initial activity emitted within Linear's required window.
- [ ] Run spawned with issue context; PR link + status posted back; session closed properly.
- [ ] Error / awaiting-input states handled.

### [P3-2] Slack summon: app (@mention + slash command)

- **Type:** Feature · **Priority:** 4 (Low) · **Estimate:** 3 · **Labels:** `cloud-agents`, `Feature` · **Depends on:** P0-4

**Why.** Slack is where a lot of "hey, can someone just do X" already happens, so it's a natural, low-friction place to summon an agent — and it completes your third surface. It's also the easiest of the three to build.

**What to build.** A Slack app (bot token, least-privilege scopes) that starts a run when someone types `@superserve <task>` (an `app_mention`) or a `/superserve` slash command, acknowledges immediately, and replies in-thread with progress + the final PR link. The richer "Assistant pane" UI is an optional stretch.

**Example.** In `#eng`: `@superserve add a healthcheck endpoint to the api` → the bot replies in-thread, then edits with a PR link when done.

**Acceptance criteria**

- [ ] `app_mention` + slash command trigger a run; immediate ack.
- [ ] In-thread progress updates + final PR link.
- [ ] Per-workspace bot-token isolation; least-privilege scopes.
- [ ] Errors reported in-thread with a reason.

---

## Cross-cutting

### [X-1] ~~Usage metering & cost attribution~~ → DROPPED (covered by SS-55)

**Decision:** Do not create. **SS-55 "Usage tracking and Billing"** already tracks vCPU/mem/storage seconds per team. Instead, add a sub-task/comment on SS-55: _agent runs must emit the same usage signals so cloud-agent compute is billed through the existing pipeline._

### [X-2] Security review: isolation, secrets, webhooks, tenancy, egress

- **Type:** Chore · **Priority:** 2 (High) · **Estimate:** 3 · **Labels:** `cloud-agents`, `Chore` · **Depends on:** P0-5, P2-1

**Why.** This feature runs _other people's code and agents_, holds _their model keys and repo tokens_, and accepts _inbound webhooks_ — so it concentrates exactly the risks that matter most. Before any external launch we need a dedicated security pass, not incidental review. (Per team practice, use the security-reviewer agent.)

**What to check.** A focused audit of: per-run network **egress** (default-deny; allow only the model + git endpoints a run needs); **secret** handling (never logged, scoped per team, via the SS-50 broker); **webhook** signature verification for GitHub/Linear/Slack; multi-tenant **RLS** coverage (prove cross-team access is impossible); and audit logging. Triage findings; fix criticals before launch.

**Acceptance criteria**

- [ ] Per-run egress is default-deny with an explicit allowlist, verified.
- [ ] Secrets never logged; RLS tested with cross-team negative cases.
- [ ] Webhook signature verification confirmed for all three providers.
- [ ] Findings triaged; criticals fixed before launch.

### [X-3] Docs: "Spawn a cloud coding agent" quickstart + summon setup

- **Type:** Improvement · **Priority:** 3 (Medium) · **Estimate:** 3 · **Labels:** `cloud-agents`, `Improvement` · **Depends on:** P1-4, P2-2

**Why.** This feature is also a marketing proof point — _"look how little it takes to run any coding agent in the cloud on Superserve."_ Good docs are what turn it from an internal tool into something customers (and our own team) actually adopt, and the natural place to show the local-spawn and summon flows.

**What to build.** User-facing docs in the Mintlify site: a **quickstart** from zero to a first PR via the MCP tool + CLI; **summon setup** guides for GitHub (then Linear/Slack); and how to configure the harness + BYOK model key. Keep the docs nav in sync with the OpenAPI spec (there's a CI check).

**Acceptance criteria**

- [ ] Quickstart gets a new user from zero to a PR via MCP/CLI.
- [ ] GitHub summon setup + BYOK/harness config documented.
- [ ] Docs nav stays in sync with the OpenAPI spec (CI check passes).

### [X-4] ~~Pricing & packaging spike~~ → DROPPED (fold into SS-55 / SS-44)

**Decision:** Do not create as a separate ticket. Cloud-agent pricing is a packaging question for the existing **SS-55 / SS-44** billing work — raise it there.

---

## Suggested sequencing (critical path)

```
P0-1 ─┬─ P0-2 ─┐
      ├─ P0-3 ─┼─ P0-4 ─┬─ P1-1 ─┬─ P1-3
      └─ P0-5 ─┘        │        └─ P1-4 ──┐
                        ├─ P1-2            │ (local-spawn MVP demoable)
                        ├─ P1-5            │
                        └─ P1-6 ─ P2-1 ─ P2-2 ─ P2-3   (GitHub summon)
                                              └─ P3-1 / P3-2  (Linear / Slack)
```

**MVP cut line:** Phase 0 + Phase 1 (+ X-2 security) = a demoable, dogfoodable "local agent → cloud agent → PR" product. Phase 2 is the first SaaS surface. X-2 (security) gates external launch; X-3 (docs) tracks P1/P2. Usage + pricing are handled in existing SS-55 / SS-44.
