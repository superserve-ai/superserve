# Long-running Research Agent

Run a Claude Managed Agent that researches topics across multiple sessions. The sandbox pauses between turns — costing nothing — while notes, citations, and draft content persist in `/workspace`. The agent picks up exactly where it left off when the next message arrives.

**The core pitch:** A deep research task might span 2 hours of wall-clock time but only 8 minutes of active compute. With Superserve, you pay for the 8 minutes.

This recipe is not about _what the agent can do_ — any agent can search the web. It is about _the economics_: research tasks are naturally bursty and idle-heavy, which makes pause/resume unusually valuable.

## How it works

```
00:00  Turn 1 — user asks research question
00:00  Sandbox created, runner starts
00:02  Agent searches 6 queries, fetches 4 pages, writes notes.md
12:30  Session idle → sandbox pauses (cost: ~0)
...
14:00  Turn 2 — user asks a follow-up
14:00  Sandbox resumes (< 1 second)
14:01  Agent reads notes.md, continues writing
17:30  Session idle → sandbox pauses again
...
Total billed: ~10 minutes. Total wall-clock: 2+ hours.
```

The agent organizes intermediate work into files that survive between sessions:

```
/workspace/research/
├── notes.md       ← running observations and key findings
├── sources.md     ← citation list with URLs and summaries
├── outline.md     ← evolving document structure
└── draft.md       ← the working output
```

When the sandbox resumes, all of this is intact. The agent opens `notes.md`, reads where it left off, and continues — no re-summarization, no context stuffing.

## Prerequisites

- A [Superserve account](https://console.superserve.ai) and API key
- An [Anthropic account](https://platform.claude.com) with Claude Managed Agents access
- A self-hosted environment created via the [Claude Platform Console](https://platform.claude.com/workspaces/default/environments)
- Python 3.12+ or Node.js 22+

## Quick start

### Python

```bash
cd python
uv sync
cp .env.example .env  # fill in your API keys
```

| Script                   | What it does                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| `build_template.py`      | Builds the `claude-research-agent` sandbox template              |
| `create_agent.py <name>` | Creates an agent with `web_search`, `web_fetch`, `read`, `write` |
| `orchestrator.py`        | Polls the work queue, creates/resumes sandboxes, starts runners  |

```bash
uv run build_template.py         # one-time
uv run create_agent.py my-agent  # one-time
uv run orchestrator.py           # long-running
```

### TypeScript

```bash
cd typescript
npm install
cp .env.example .env  # fill in your API keys
```

| Script                    | What it does                                                     |
| ------------------------- | ---------------------------------------------------------------- |
| `build-template.mjs`      | Builds the `claude-research-agent` sandbox template              |
| `create-agent.mjs <name>` | Creates an agent with `web_search`, `web_fetch`, `read`, `write` |
| `orchestrator.mjs`        | Polls the work queue, creates/resumes sandboxes, starts runners  |

```bash
node build-template.mjs         # one-time
node create-agent.mjs my-agent  # one-time
node orchestrator.mjs           # long-running
```

## Key differences from the base recipe

- **Model:** `claude-opus-4-8` (research quality matters here)
- **Tools:** `web_search`, `web_fetch`, `read`, `write` (no bash — research is file-based)
- **`IDLE_TIMEOUT`:** 600 seconds (10 minutes instead of 5 — research agents have longer natural pauses between multi-step tasks)
- **Template:** `claude-research-agent` (same base image, same packages — the distinction is intentional for clarity)

## See also

- [Full guide](https://docs.superserve.ai/integrations/managed-agents/claude-managed-agents)
- [Base recipe](../../) — simpler starting point if you don't need web tools
- [Claude Managed Agents docs](https://platform.claude.com/docs/en/managed-agents/overview)
