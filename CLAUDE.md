# CLAUDE.md

Guidelines for working with the Superserve CLI repository.

## What This Repository Is

Superserve is a CLI and SDK for deploying AI agents to sandboxed cloud containers. Users write an agent (typically using the Claude Agent SDK), point `superserve deploy` at it, and get a hosted agent they can interact with via `superserve run`.

This repo is the open-source CLI (`superserve` on PyPI). The platform API and dashboard live in a separate private repo (`rayai-platform`).

## Architecture

```
src/superserve/
├── cli/
│   ├── cli.py              # Main Click group entry point
│   ├── analytics.py        # Anonymous usage analytics (PostHog)
│   ├── utils.py             # Shared CLI helpers (formatting, spinners)
│   ├── commands/            # Click command implementations
│   │   ├── agents.py        # superserve agents [list|get|delete]
│   │   ├── deploy.py        # superserve deploy
│   │   ├── init.py          # superserve init
│   │   ├── login.py         # superserve login (device auth flow)
│   │   ├── logout.py        # superserve logout
│   │   ├── run.py           # superserve run (SSE streaming)
│   │   ├── secrets.py       # superserve secrets [set|list|delete]
│   │   └── session.py       # superserve sessions [list|get|end]
│   ├── platform/            # Platform API client layer
│   │   ├── auth.py          # Token management and refresh
│   │   ├── client.py        # PlatformClient (HTTP requests to API)
│   │   ├── config.py        # API URLs, credentials path, constants
│   │   └── types.py         # Pydantic models for API responses
│   └── templates/           # Project scaffolding templates
└── sandbox/                 # Legacy sandbox code (not actively used)
```

## Key Patterns

- **Click for CLI**: All commands use Click decorators. The main group is in `cli.py`, subcommands in `commands/`.
- **PlatformClient**: All API calls go through `PlatformClient` in `platform/client.py`. It handles auth headers, token refresh, and error formatting.
- **`_resolve_agent_id()`**: Converts agent name → UUID. Results are cached on the client instance.
- **Agent IDs**: Prefixed with `agt_`, run IDs with `run_`, session IDs with `ses_`.
- **SSE streaming**: `run.py` streams agent responses via Server-Sent Events. Events include `message`, `status`, `error`, `done`.
- **Device auth flow**: `login.py` uses device code grant — opens browser, polls for token.
- **Config file**: `superserve.yaml` defines agent name, start command, secrets, and ignore patterns.

## CLI Commands

| Command | Description |
|---------|-------------|
| `superserve login` | Authenticate via browser |
| `superserve logout` | Clear stored credentials |
| `superserve init` | Generate `superserve.yaml` |
| `superserve deploy` | Deploy agent to platform |
| `superserve run AGENT` | Interactive session with agent |
| `superserve secrets set AGENT KEY=VALUE` | Set encrypted secrets |
| `superserve secrets list AGENT` | List secret names |
| `superserve secrets delete AGENT KEY` | Delete a secret |
| `superserve agents list` | List deployed agents |
| `superserve agents get AGENT` | Get agent details |
| `superserve agents delete AGENT` | Delete an agent |
| `superserve sessions list` | List sessions |
| `superserve sessions get ID` | Get session details |
| `superserve sessions end ID` | End a session |

## Development

```bash
# Install in editable mode
pip install -e ".[dev]"

# Lint and format
uv run ruff check . --fix
uv run ruff format .

# Type check
uv run mypy src/

# Test
uv run pytest
```

## Coding Style

- Python 3.12+, type hints on function signatures
- Ruff for linting and formatting (line length 88)
- Click for CLI commands, Pydantic for API types
- Keep functions focused, avoid deep nesting
- Use specific exception types, not bare `except:`
- Validate inputs at system boundaries

## Branding

- CLI tool is `superserve`, platform is `Superserve`
- Never use "Claude" standalone — use "Claude Agent" or "Claude Agent SDK"
- Internal infra names (e.g. `claude-runtime-template`) are fine but should migrate over time

## Git

- Single-line commit messages
- Do not include "Co-Authored-By" or AI attribution in commits
