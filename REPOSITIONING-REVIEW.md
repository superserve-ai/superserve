# Repositioning Review — Docs (Mintlify)

Surface: `docs/` (Mintlify, MDX + `docs.json`).
Thesis: Superserve → **open agent infrastructure**. Two composable primitives on one substrate —
**Sandbox** ("a computer that remembers", already shipping) and **Actor** ("a process that survives",
the new first-class concept, today only a hand-built pattern). Framing: the platform is the durable
**body**, any harness is the interchangeable **brain**.

This file holds (a) new-page proposals that I did **not** create, and (b) anything I judged
higher-risk than a prose touch. Low/medium-risk prose edits were applied directly (listed at the
bottom). I did **not** invent any SDK/API surface in shipped docs.

---

## A. Proposed new pages (NOT created — need approval + IA decision)

### A1. "Actors" concept page — `docs/concepts/actors.mdx` (or `docs/actors/overview.mdx`)

**Why:** Actor is the new half of the thesis and currently has no home in the docs. It should be
introduced as a _concept / platform direction_, not as a shipped API — there is no Actor type in the
SDK today (the pattern is hand-built today, e.g. the orchestrator/runner loop in
`integrations/managed-agents/claude-managed-agents`). Copy must be forward-looking and must not claim
methods/endpoints that don't exist.

**Proposed positioning sentence:**

> An **Actor** is a process that survives: a named, durable, single-writer entity that wakes on
> events, serializes its input through an inbox, checkpoints its state, and hibernates between events
> — addressable by id from anywhere. Conceptually, **Actor = Sandbox + identity + inbox + durable
> orchestration**.

**Proposed structure:**

- What an Actor is (body/brain recap; Actor builds on the sandbox body).
- Actor vs. Sandbox (a sandbox is compute that remembers; an actor adds identity, an inbox, and
  durable orchestration on top).
- The durability ladder (see A2) — where each level lands.
- "Today vs. direction" callout: be explicit that Actors are the **platform direction**. Show the
  pattern you can build today on sandboxes (find-or-create by metadata id, pause/resume between
  turns — exactly what the managed-agents guide already does) and frame the first-class Actor API as
  forthcoming.

**Risk:** Medium-high (introduces a primary concept). Needs product sign-off on how far the
forward-looking language goes, and a decision on whether a new top-level nav group ("Concepts") is
created. Hence not written.

### A2. "Harness Contract" page — `docs/concepts/harness-contract.mdx`

**Why:** The body/brain framing relies on a clean contract for swapping brains. Worth stating
explicitly, but it describes a contract/spec, so it belongs in review rather than being asserted as
shipped docs.

**Proposed content:**

- The contract in one line: **turn → stream → idle**. A harness receives a turn, streams output, and
  signals idle; the body handles everything around it (compute, fs, lifecycle, wake/resume).
- The durability ladder:
  - **L0 — drop-in:** run any harness/OCI image unchanged on the durable body.
  - **L1 — event-driven:** the body wakes the harness on events and streams its output.
  - **L2 — step-level replay:** checkpoint and replay at step granularity.
- "Bring your OCI image, it just runs": honor the image `ENTRYPOINT`/`CMD`; one call from image.
  **NOTE:** confirm the one-call-from-image / honor-ENTRYPOINT path actually ships before documenting
  it as available — the introduction edits intentionally do **not** claim it yet.

**Risk:** Medium-high (new spec-like surface, ladder terminology is product-defining). Not written.

### A3. Nav (`docs.json`) changes implied by A1/A2

If A1/A2 are approved, add a **"Concepts"** group to the Documentation tab, e.g.:

```jsonc
{
  "group": "Concepts",
  "pages": ["concepts/actors", "concepts/harness-contract"],
}
```

Top-level nav IA is **high-risk** per the rules, so I did not touch `docs.json` navigation. Proposing
the exact group above for approval.

---

## B. Higher-risk copy I did NOT change (flagging only)

### B1. `docs.json` `"name": "Superserve"`

Left as-is. The product name is unchanged by this repositioning; "open agent infrastructure" is a
tagline/positioning line, not a rename. No change proposed unless product wants a navbar tagline.

### B2. Pre-existing `docs:check-nav` failure (NOT mine)

`bun run docs:check-nav` already fails on `main`/baseline, before any of my edits. It is unrelated to
this repositioning — it checks that the **API Reference** nav in `docs.json` stays in sync with the
OpenAPI spec, and it reports:

- spec has but nav lacks: `GET /billing/pricing`, `GET /billing/pricing/public`
- nav has but spec lacks: `POST /sandboxes/{sandbox_id}/exec`, `POST /sandboxes/{sandbox_id}/exec/stream`
  This is an API/spec drift issue (note the recent commit "remove legacy controlplane exec endpoint").
  I did **not** edit the API Reference nav and did **not** fix this, since it is out of scope for a docs
  repositioning and touches the OpenAPI contract. Flagging so it isn't mistaken for regression from my
  edits.

---

## C. Edits applied directly (low/medium-risk prose)

- `docs/introduction.mdx`
  - Frontmatter `description` → "open agent infrastructure — durable agents and persistent sandboxes
    that run any harness, powered by Firecracker MicroVMs."
  - Added an opening umbrella paragraph (open agent infra + body/brain) and a sandbox = "a computer
    that remembers" paragraph above the existing template line. Kept all existing sandbox capability
    bullets verbatim.
  - Added a "Run any harness" section (body/brain, pause/resume by id, link to integration guides).
    Only claims shipped features (pause/resume, templates, exec, files).
- `docs/integrations/agent-harnesses/claude-agent-sdk.mdx` — intro reworded to body/brain ("the brain"
  / "the durable body it runs on"; "isolated, resumable VM"). No code/API changes.
- `docs/integrations/agent-harnesses/openai-agents-sdk.mdx` — same body/brain alignment in the intro.

Other integration pages (coding-agents/_, personal-agents/_, managed-agents/_, virtual-filesystems/_)
were left as-is: their intros are task-specific ("Run X in a Superserve sandbox") and already read
cleanly; forcing body/brain language into each would be heavier-handed than the "lightly align where
low-risk" instruction warrants. The two "Agent Harnesses" pages were the natural fit because they
already framed the sandbox as the runtime for a harness.
