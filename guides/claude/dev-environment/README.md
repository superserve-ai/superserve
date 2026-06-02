# Persistent Dev Environment

A Claude Managed Agent that acts as a conversational coding assistant with a durable development environment. Clone a repo once, install dependencies once — they are all still there the next session. The sandbox filesystem is the memory.

This recipe gives you a conversational coding assistant with durable state. For a fully autonomous coding agent that works without turn-by-turn guidance, see the [Claude Code guide](https://docs.superserve.ai/integrations/coding-agents/claude).

**The core pitch:** Every developer has lost time re-cloning, re-installing, re-compiling just to continue a conversation they had yesterday. This recipe eliminates that.

## How it works

```
Session 1: "Clone https://github.com/acme/api and get it running"
  → agent: git clone, npm install, runs tests, all pass
  → agent writes /workspace/.session-notes with repo state
  → session ends → sandbox pauses

Session 2 (next day): "Add rate limiting to the /search endpoint"
  → sandbox resumes, node_modules still there
  → agent reads .session-notes, knows exactly where things stand
  → agent edits files, runs tests, no reinstall needed

Session 3: "Write tests for the rate limiter"
  → same sandbox, full context intact
  → agent runs the test suite, everything works
```

The agent maintains a `/workspace/.session-notes` file that documents what is installed, what branch is checked out, and what was last worked on. This is the agent's handoff note to itself:

```markdown
# Session Notes — acme/api

## Environment
- Repo: /workspace/acme-api (main branch, clean)
- Node: 20.x, npm 10.x
- node_modules: installed (last updated 2025-05-28)
- Tests: all passing (jest, 47 tests)

## Last session
Added rate limiting middleware to /search endpoint using express-rate-limit.
Still TODO: write tests for the rate limiter.

## Next
- Add tests in /tests/rate-limit.test.js
- Consider adding sliding window vs fixed window options
```

Session 2 startup vs. a fresh sandbox: fresh requires `npm install` (30-90 seconds for a typical project); persistent resumes in under 1 second with everything ready.

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

| Script | What it does |
|---|---|
| `build_template.py` | Builds the `claude-dev-environment` template (includes node, build-essential, ripgrep) |
| `create_agent.py <name>` | Creates an agent with `bash`, `read`, `write`, `edit`, `glob`, `grep` |
| `orchestrator.py` | Polls the work queue, creates/resumes sandboxes, starts runners |

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

| Script | What it does |
|---|---|
| `build-template.mjs` | Builds the `claude-dev-environment` template (includes node, build-essential, ripgrep) |
| `create-agent.mjs <name>` | Creates an agent with `bash`, `read`, `write`, `edit`, `glob`, `grep` |
| `orchestrator.mjs` | Polls the work queue, creates/resumes sandboxes, starts runners |

```bash
node build-template.mjs         # one-time
node create-agent.mjs my-agent  # one-time
node orchestrator.mjs           # long-running
```

## Key differences from the base recipe

- **Template:** `claude-dev-environment` — richer than the base, includes `nodejs`, `npm`, `build-essential`, and `ripgrep` pre-installed
- **Tools:** `bash`, `read`, `write`, `edit`, `glob`, `grep` (no web tools — this is a coding agent)
- **Model:** `claude-sonnet-4-6`
- **System prompt:** Instructs the agent to read `.session-notes` at session start and update it at session end

## See also

- [Full guide](https://docs.superserve.ai/integrations/managed-agents/dev-environment)
- [Base recipe](../claude-managed-agents/) — simpler starting point without the session-notes pattern
- [Claude Code guide](https://docs.superserve.ai/integrations/coding-agents/claude) — fully autonomous coding agent (no turn-by-turn guidance)
- [Claude Managed Agents docs](https://platform.claude.com/docs/en/managed-agents/overview)
