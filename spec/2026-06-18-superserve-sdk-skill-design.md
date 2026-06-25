# Superserve SDK Agent Skill (SKILL.md) — Design

**Date:** 2026-06-18
**Ticket:** SS-91 (agent skills)
**Status:** Approved (design), authoring in progress

## Goal

Author a consumer-facing `SKILL.md` so that AI coding agents (Claude Code, and the
broader skill ecosystem) can correctly drive the Superserve sandbox SDKs to create
and manage Firecracker microVM sandboxes — modeled on best practices distilled from
the leading sandbox providers.

This is **consumer-facing** ("how to write code that *uses* the SDK"), explicitly
distinct from the **contributor** doc (`CLAUDE.md`, which already plays the
`AGENTS.md` role: "how to work *on* this monorepo"). Keeping these separate is the
single most common mistake competitors make.

## Research summary (8 providers)

| Provider | Ships | Standout |
|---|---|---|
| **Daytona** | `llms.txt` + `llms-full.txt` + installable `SKILL.md` (`github.com/daytona/skills`) | Progressive disclosure: trigger-rich frontmatter, "Before You Start" preflight, "Quick Decision Tree", detail in `references/` |
| **Together AI** | 12 installable skills incl. `together-sandboxes/SKILL.md` | "When This Skill Wins" vs "Hand Off To Another Skill"; "High-Signal Rules" |
| **Cloudflare** | 3-tier docs + `cloudflare/skills` SKILL.md | Anti-Patterns section; "When to Use What" / "Quick Reference" decision tables |
| **E2B** | `llms.txt`/`-full` + rich SDK ref | Paired JS/Python examples with inline footgun comments (`🚨 ms vs seconds`); ~15-class typed-error taxonomy |
| **Vercel** | `llms.txt`/`-full` + task SKILL.md | `withBrowser()` try/finally cleanup wrapper; evals showing a compact docs-index beats a verbose skill |
| **Modal** | `llms.txt`/`-full` + "Developing with LLMs" page | "Differences from standard development" — corrects an LLM's wrong priors |
| Runloop / Blaxel | in-repo `llms.txt` / `AGENTS.md` | decision-oriented "Key Guidance"; honest latency/caveat numbers |

**No single provider nails it.** Our SKILL.md is a deliberate composite:
- **Daytona's structure** (progressive disclosure, preflight, decision aids)
- **Together's "when it wins / hand off"** scoping
- **Cloudflare's tables + explicit anti-patterns**
- **E2B's paired dual-language examples + real typed-error table**

**Two formats, different jobs.** A `SKILL.md` is loaded on demand by Claude when a
task matches its `description`; `llms.txt`/`llms-full.txt` is the docs corpus any
agent fetches. Our Mintlify docs already auto-emit `llms.txt`/`llms-full.txt`, so
that surface is largely free — the `SKILL.md` is the net-new work.

**Superserve is ahead on two axes** the field is weak on, so we lean in:
1. Real `pause()`/`resume()`/`kill()` verbs (half the field emulates these via snapshots).
2. A genuine typed-error hierarchy (most competitors ship a single "check the exit code" line).

## Decisions

1. **Home / distribution:** `skills/superserve/SKILL.md` in this monorepo (canonical
   home; can seed a public `superserve/skills` repo later).
2. **Scope:** TS SDK (`@superserve/sdk`) + Python SDK (`superserve`), plus a short CLI
   section for the `superserve` CLI (a distinct deploy/run-hosted-agents surface).
3. **Depth:** single self-contained `SKILL.md`; link the live Mintlify docs (incl.
   `llms.txt`) for deep per-method detail rather than bundling `references/`.

## Structure (section outline)

```
frontmatter   name: superserve; trigger-rich description (what + when)
Overview      Firecracker microVMs; control-plane vs data-plane (SDK hides it)
When this skill wins / Hand off elsewhere
Before you start   preflight: SDK installed + SUPERSERVE_API_KEY (ss_live_)
Quickstart    paired TS + Python, ~6 lines: create → run → file → kill (try/finally)
Lifecycle     active ↔ paused → deleted; exec auto-resumes; token rotation handled
Common operations   scannable table: Task | TS call | Python call | Returns/notes
Auth & environment  env var, never hardcode, AbortSignal/timeout, auto-retry
Error handling      typed-error table, "Thrown when…" (Python SandboxTimeoutError)
Gotchas & anti-patterns   two tight lists
CLI           short section: deploy/run hosted agents (distinct surface)
Reference     live docs links + "prefer retrieval over training data"
```

## Quality bar (dos / don'ts)

- **Token budget:** body under ~5k tokens (the on-trigger Level-2 cost). Push
  exhaustive per-method detail to the live docs, not the body.
- **Tables over prose** for ops/errors (denser, faster for agents to parse).
- **Paired TS + Python** for every operation; mirror camelCase ↔ snake_case.
- **Inline footgun comments** carry load-bearing facts (the `timeoutMs` ms vs
  `timeout_seconds` seconds unit difference is the headline one).
- **No bad secret hygiene** — never `apiKey: "YOUR_API_KEY"` inline; always read
  `SUPERSERVE_API_KEY` from the env.
- **Guaranteed cleanup** — show `kill()` in a `finally` (no `await using` / `with`).
- **Description states both what + when**, packed with trigger keywords; it is the
  only thing in context at discovery, so a what-only description never fires.
- **Consumer-facing only** — do not mix in contributor/build instructions.

## Acceptance criteria

- Every method name, signature, option, and example in the SKILL.md verified against
  the actual SDK/CLI source (no hallucinated API).
- `name`/`description` pass Agent Skill validation (lowercase-hyphen name; no
  "claude"/"anthropic"; description ≤ 1024 chars; both what + when present).
- Body comfortably under the ~5k-token Level-2 budget.
- TS and Python examples are at parity and copy-paste runnable.
- Links resolve to live docs surfaces (`docs.superserve.ai`, `llms.txt`, sdk-reference).
```
