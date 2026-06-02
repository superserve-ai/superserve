# Recipe: Persistent Dev Environment

## What it is

A Claude Managed Agent that acts as a conversational coding assistant with a durable development environment. Clone a repo once, install dependencies once — they're all still there the next session. The sandbox filesystem is the memory.

**The core pitch:** Every developer has lost time re-cloning, re-installing, re-compiling just to continue a conversation they had yesterday. This recipe eliminates that.

---

## Why it's differentiated

### vs. the existing Claude Code guide

The existing [coding-agents/claude.mdx](../../docs/integrations/coding-agents/claude.mdx) guide shows how to run **Claude Code** (a terminal-based autonomous agent) inside a Superserve sandbox. This recipe is different:

- **Claude Code guide:** Claude drives a full terminal session — it runs autonomously, makes changes, and reports back. Best for "go fix this PR" tasks.
- **This recipe:** You have a **back-and-forth conversation** with a coding assistant, and the environment persists between turns. Best for "help me build this feature over the next few days" workflows.

The interaction model is different. The environment persistence story is the same (and complementary — both are valid use cases).

### vs. other managed agent platforms

Most platforms give you a sandbox that resets on every session. You can't `npm install` in session 1 and use those packages in session 2. Superserve's pause/resume preserves the full filesystem — `node_modules/`, virtual environments, compiled binaries, `.git/` state, everything.

---

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

The key: the agent maintains a `/workspace/.session-notes` file that documents what's installed, what branch is checked out, what was last worked on. This is the agent's "handoff note to itself."

---

## Implementation

### Template (`claude-dev-environment`)
- Base: `python:3.12-slim`
- System deps: `curl git jq procps build-essential`
- Additional: `nodejs npm` (or `nvm` for multi-version support), `ripgrep` (for fast grep in large repos)
- Python packages: `anthropic` (runner)

This is a richer template than the base — more tools pre-installed so the agent isn't waiting on apt-get during the session.

### Agent
- **Model:** `claude-sonnet-4-6`
- **Tools:** `bash`, `read`, `write`, `edit`, `glob`, `grep`
- **System prompt:**
  ```
  You are a coding assistant with a persistent development environment at /workspace.
  Your environment — installed packages, cloned repositories, build artifacts — 
  survives between sessions.

  At the start of every session:
  1. Run: ls /workspace/ to see what's there
  2. Read /workspace/.session-notes if it exists

  After each session, update /workspace/.session-notes with:
  - What repository is checked out and what branch
  - What packages/tools are installed
  - What you last worked on and what's next

  This means: install dependencies once. Run tests instantly. Never re-clone.
  Work carefully and test your changes before reporting completion.
  ```

### Orchestrator changes from base
- `TEMPLATE_NAME = "claude-dev-environment"`
- Everything else identical to the base recipe

### Runner
- Identical to base

---

## What to show in the README / docs

**Lead with the session handoff pattern.** Show the `.session-notes` file as the key artifact:

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

This is something users immediately understand — it's the README equivalent of "notes from the previous shift."

**Then show timing.** Session 2 startup vs. a fresh sandbox: fresh requires `npm install` (30-90 seconds for a typical project); persistent resumes in < 1 second with everything ready.

---

## Files to create

```
guides/claude/dev-environment/
├── README.md
├── python/
│   ├── .env.example
│   ├── pyproject.toml
│   ├── build_template.py     ← richer template: node, build-essential, ripgrep
│   ├── create_agent.py       ← bash/read/write/edit/glob/grep, no web tools
│   ├── orchestrator.py       ← TEMPLATE_NAME="claude-dev-environment"
│   └── runner.py             ← identical to base
└── typescript/
    ├── .env.example
    ├── package.json
    ├── build-template.mjs    ← same richer template
    ├── create-agent.mjs      ← same tool set, different system prompt
    └── orchestrator.mjs      ← TEMPLATE_NAME="claude-dev-environment"
```

```
docs/integrations/managed-agents/dev-environment.mdx
```

---

## Positioning note

Clearly distinguish this from the Claude Code guide in both the README and docs page. One sentence: "This recipe gives you a conversational coding assistant with durable state. For a fully autonomous coding agent that works without turn-by-turn guidance, see the Claude Code guide." Then link.
