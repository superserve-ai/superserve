<div align="center">
  <br/>
  <br/>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/superserve-ai/superserve/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/superserve-ai/superserve/main/assets/logo-light.svg">
  </picture>

  <br/>
  <br/>

  <p><strong>Workspaces for agents. Isolation, persistence, and governance - one command, no config.</strong></p>

  [![Docs](https://img.shields.io/badge/Docs-latest-blue)](https://docs.superserve.ai/)
  [![License](https://img.shields.io/badge/License-OCVSAL_1.0-blue.svg)](https://github.com/superserve-ai/superserve/blob/main/LICENSE)
  [![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://python.org)
  [![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?logo=discord&logoColor=white)](https://discord.gg/utftfhSK)

</div>

## Why Superserve

Agents execute code, make HTTP requests, and manage credentials. In production, every session needs its own isolated environment with persistent state and governance. Building that yourself means stitching together containers, proxies, secret managers, and logging.

Superserve gives every agent a governed workspace out of the box.

## Features

- **Isolated by default** - Every session runs in its own Firecracker microVM. Nothing leaks between sessions or touches your infrastructure
- **Nothing disappears** - The `/workspace` filesystem persists across turns, restarts, and days. Resume where you left off
- **Credentials stay hidden** - A credential proxy injects API keys at the network level. The agent never sees them - they never appear in LLM context, logs, or tool outputs
- **Any framework** - Claude Agent SDK, OpenAI Agents SDK, LangChain, Mastra, Pydantic AI, or plain stdin/stdout
- **One command** - `superserve deploy agent.py`. No Dockerfile, no server code, no config files
- **Real-time streaming** - Stream tokens and tool calls as they happen
- **Sub-second cold starts** - Pre-provisioned containers mean your agent starts almost instantly

## Quick Start

Install the CLI:

```bash
curl -fsSL https://superserve.ai/install | sh
```

Or via npm:
```bash
npm install -g @superserve/cli
```

Or via Homebrew:
```bash
brew install superserve-ai/tap/superserve
```

Log in and deploy:

```bash
superserve login
superserve deploy agent.py
```

Set your secrets:

```bash
superserve secrets set my-agent ANTHROPIC_API_KEY=sk-ant-...
```

Run your agent:

```bash
superserve run my-agent
```

```
You > What is the capital of France?

Agent > The capital of France is Paris.

Completed in 1.2s

You > And what's its population?

Agent > Paris has approximately 2.1 million people in the city proper.

Completed in 0.8s
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `superserve login` | Authenticate with Superserve |
| `superserve init` | Generate `superserve.yaml` for your project |
| `superserve deploy` | Deploy your agent |
| `superserve run AGENT` | Run an interactive session |
| `superserve secrets set AGENT KEY=VALUE` | Set encrypted environment variables |
| `superserve secrets list AGENT` | List secret key names |
| `superserve agents list` | List deployed agents |
| `superserve agents get AGENT` | Get agent details |
| `superserve agents delete AGENT` | Delete an agent |
| `superserve sessions list` | List sessions |

See the full [CLI Reference](https://docs.superserve.ai/cli) for all flags and options.

## Python SDK

The Python SDK lets you build agents with a simple turn-based loop. Install it with pip or uv:

```bash
pip install superserve
```

Or with uv:

```bash
uv add superserve
```

### Basic Usage

```python
from superserve.sdk import App

app = App("my-agent")

@app.session
async def run(session):
    async for message, stream in session.turns():
        stream.write(f"You said: {message}")

app.run()
```

### How It Works

- **`App`** — entry point. Give it a name and register a session handler with the `@app.session` decorator
- **`Session`** — manages the turn loop. Call `session.turns()` to async-iterate over `(message, stream)` pairs
- **`Stream`** — output channel for each turn:
  - `stream.write(text)` — send text or structured content to the user
  - `stream.status("Thinking...")` — send a transient status message
  - `stream.metadata({"cost": 0.01})` — send metadata (not shown to user)

### Modes

The SDK auto-detects its environment:

- **Terminal mode** (default) — interactive stdin/stdout, reads from `input()` and prints responses
- **Platform mode** (`SUPERSERVE=1`) — JSON protocol on stdin/stdout, used when deployed to Superserve

### Deploy

Write your agent, then deploy with the CLI:

```bash
superserve deploy agent.py
superserve run my-agent
```

The SDK works with any framework — Claude Agent SDK, LangChain, Pydantic AI, or plain Python. See the [examples](examples/python/) directory for framework-specific agents.

## Requirements

- A [Superserve account](https://console.superserve.ai)

## Development

This repo is a monorepo managed with [Bun workspaces](https://bun.sh/docs/install/workspaces) and [Turborepo](https://turbo.build/repo).

- **Bun workspaces** - single `bun.lock` at the root, shared `node_modules`, workspace packages reference each other with `workspace:*`
- **Turborepo** - runs tasks across packages in the correct order, caches outputs, and parallelizes where possible

### Structure

```
apps/
  playground/              # React + Vite playground app
packages/
  cli/                     # TypeScript CLI (@superserve/cli)
  python-sdk/              # Python SDK (superserve on PyPI)
  sdk/                     # TypeScript SDK (@superserve/sdk)
  typescript-config/       # Shared tsconfig presets
  biome-config/            # Shared Biome config
```

### Setup

```bash
bun install               # install all dependencies
```

### Running Commands

Run tasks across all packages from the repo root:

```bash
bun run build             # build all packages
bun run dev               # start all dev servers
bun run lint              # lint all packages
bun run typecheck         # type check all packages
bun run test              # run all tests
```

Target a specific package with `--filter`:

```bash
bunx turbo run dev --filter=@superserve/playground
bunx turbo run build --filter=@superserve/sdk
```

### Testing the CLI Locally

The CLI doesn't have a dev server. Run it directly with Bun:

```bash
bun packages/cli/src/index.ts deploy --help
bun packages/cli/src/index.ts login
```

### Adding Dependencies

Always add dependencies from the repo root using `--filter`:

```bash
bun add zod --filter @superserve/cli
bun add react --filter @superserve/playground
bun add -d @types/node --filter @superserve/sdk
```

> **Note:** Do not `cd` into a package directory and run `bun add` directly - this creates a separate `bun.lock` that conflicts with the monorepo's root lockfile.

### Shared Configs

TypeScript and Biome configs are shared across packages:

- **`@superserve/typescript-config`** - extend in `tsconfig.json` with `"extends": "@superserve/typescript-config/base.json"`
- **`@superserve/biome-config`** - extend in `biome.json` with `"extends": ["@superserve/biome-config/biome.json"]`

When updating linting rules or compiler options, prefer updating the shared config so all packages stay consistent.

### Python SDK

The Python SDK lives in `packages/python-sdk/` and is managed with **uv workspaces** (workspace root at `pyproject.toml`):

```bash
uv sync                                              # install Python dependencies
uv run pytest packages/python-sdk/tests/              # run tests
uv run ruff check packages/python-sdk/                # lint
uv run mypy packages/python-sdk/src/superserve/       # type check
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](https://github.com/superserve-ai/superserve/blob/main/CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Open Core Ventures Source Available License (OCVSAL) 1.0 - see the [LICENSE](https://github.com/superserve-ai/superserve/blob/main/LICENSE) file for details.

---

If you find Superserve useful, please consider giving us a star!
