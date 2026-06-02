# Recipe: Long-running Research Agent

## What it is

A Claude Managed Agent that researches topics across multiple sessions. Between turns the sandbox pauses — costing nothing — while notes, citations, and draft content persist in `/workspace`. The agent picks up exactly where it left off, with full file context, when the next message arrives.

**The core pitch:** A deep research task might span 2 hours of wall-clock time but only 8 minutes of active compute. With Superserve, you pay for the 8 minutes.

---

## Why it's differentiated

Most sandbox platforms charge for time the agent is idle (waiting for a user to respond, waiting for a long web fetch to return). Superserve's pause/resume means the sandbox is free during those gaps.

The other piece is **persistent file state**. The agent organizes intermediate work into files:

```
/workspace/research/
├── notes.md       ← running observations
├── sources.md     ← citation list with URLs and summaries
├── outline.md     ← evolving document structure
└── draft.md       ← the working output
```

When the sandbox resumes, all of this is intact. The agent opens `notes.md`, reads where it left off, and continues — no re-summarization, no context stuffing.

---

## How it works

```
Turn 1: "Research the regulatory landscape for AI agents in the EU"
  → sandbox created, agent web_searches + web_fetches, writes notes.md + sources.md
  → session idle → sandbox pauses (cost: ~0)

Turn 2: "Add a section on enforcement history"
  → sandbox resumes in <1s
  → agent reads existing notes.md, continues writing
  → session idle → sandbox pauses again

Turn 3: "Draft an executive summary"
  → sandbox resumes, agent reads outline.md + notes.md, writes draft.md
  → user reads draft in the conversation
```

The sandbox runs only when the agent is actively working. Everything in between is free.

---

## Implementation

### Template (`claude-research-agent`)
- Base: `python:3.12-slim`
- System deps: `curl git jq procps`
- Python packages: `anthropic` (for runner) — no extra packages needed; web tools are handled by Anthropic, not the sandbox

### Agent
- **Model:** `claude-opus-4-8` (research quality matters here)
- **Tools:** `web_search`, `web_fetch`, `read`, `write`
- **System prompt:**
  ```
  You are a research agent with a persistent sandbox. Your /workspace/research/ 
  directory survives between sessions — always start by reading your existing files 
  to orient yourself before doing new work.

  Organize your work into:
  - /workspace/research/notes.md — observations and key findings
  - /workspace/research/sources.md — URLs, titles, one-line summaries
  - /workspace/research/outline.md — document structure
  - /workspace/research/draft.md — the output being built

  Save progress after every significant step. Be systematic: search broadly first, 
  then fetch and read the most relevant sources in depth.
  ```

### Orchestrator changes from base
- `IDLE_TIMEOUT = 600` (10 minutes instead of 5 — research agents have longer natural pauses between multi-step tasks)
- Everything else identical to the base recipe

### Runner
- Identical to base

---

## What to show in the README / docs

**Lead with the cost angle.** Show a timeline:

```
00:00  Turn 1 — user asks research question
00:00  Sandbox created, runner starts
00:02  Agent searches 6 queries, fetches 4 pages, writes notes.md
12:30  Session idle → sandbox pauses
...
14:00  Turn 2 — user asks a follow-up
14:00  Sandbox resumes (< 1 second)
14:01  Agent reads notes.md, continues
17:30  Session idle → sandbox pauses
...
Total billed: ~10 minutes. Total wall-clock: 2+ hours.
```

**Then show the file persistence angle.** Snippet of agent reading its own prior notes and continuing seamlessly.

---

## Files to create

```
guides/claude/research-agent/
├── README.md
├── python/
│   ├── .env.example
│   ├── pyproject.toml
│   ├── build_template.py
│   ├── create_agent.py
│   ├── orchestrator.py       ← IDLE_TIMEOUT=600, TEMPLATE_NAME="claude-research-agent"
│   └── runner.py             ← identical to base
└── typescript/
    ├── .env.example
    ├── package.json
    ├── build-template.mjs
    ├── create-agent.mjs
    └── orchestrator.mjs      ← IDLE_TIMEOUT=600_000, same template name
```

```
docs/integrations/managed-agents/research-agent.mdx
```

---

## Positioning note

This recipe is not about *what the agent can do* — any agent can search the web. It's about *the economics*: research tasks are naturally bursty and idle-heavy, which makes pause/resume unusually valuable here. Lead with that.
