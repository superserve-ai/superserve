# CLAUDE.md

Guidelines for working with the Superserve monorepo.

## What This Repository Is

Superserve is a CLI and SDK for deploying AI agents to sandboxed cloud containers. Users write an agent (typically using the Claude Agent SDK), point `superserve deploy` at it, and get a hosted agent they can interact with via `superserve run`.

This repo is a monorepo containing the CLI, TypeScript SDK, console, and UI library. The platform API and dashboard are being migrated here from a separate repo.

## Monorepo Structure

```
superserve/
├── apps/
│   ├── console/                 # React + Vite console app
│   └── ui-docs/                 # UI component documentation
├── packages/
│   ├── cli/                     # TypeScript CLI (@superserve/cli on npm)
│   ├── python-sdk/              # Python SDK (superserve on PyPI)
│   ├── sdk/                     # TypeScript SDK (@superserve/sdk on npm)
│   ├── typescript-config/       # Shared tsconfig presets
│   └── biome-config/            # Shared Biome linting/formatting config
├── docs/                        # Mintlify documentation, no specs or planning docs here
└── examples/                    # Example projects
```

**Workspace tooling:**
- **Bun workspaces** for dependency management (single `bun.lock` at root)
- **Turborepo** for task orchestration (build, lint, typecheck, test)
- **uv workspaces** for Python packages (`pyproject.toml` at root as workspace root)

## Architecture

### TypeScript CLI (`packages/cli/`)

Built with Bun + Commander. Entry point: `src/index.ts`.

### TypeScript SDK (`packages/sdk/`)

Published as `@superserve/sdk` with dual CJS/ESM output via tsup. Includes React hooks at `@superserve/sdk/react`.

### Python SDK (`packages/python-sdk/`)

Published as `superserve` on PyPI. Provides the `App`, `Session`, and `Stream` classes for building agents in Python. Zero runtime dependencies.

## Key Patterns

- **Agent IDs**: Prefixed with `agt_`, run IDs with `run_`, session IDs with `ses_`.
- **SSE streaming**: Agent responses stream via Server-Sent Events. Events include `message`, `status`, `error`, `done`.
- **Config file**: `superserve.yaml` defines agent name, start command, secrets, and ignore patterns.
- **Shared configs**: TypeScript projects extend from `@superserve/typescript-config` presets. Biome projects extend from `@superserve/biome-config`.

## Development

```bash
# Install all dependencies (from repo root)
bun install

# TypeScript — all projects
bun run build              # Build everything in dependency order
bun run dev                # Start all dev servers
bun run lint               # Lint all TS projects
bun run typecheck          # Type check all TS projects
bun run test               # Run all TS tests

# TypeScript — single project
bunx turbo run dev --filter=@superserve/console
bunx turbo run build --filter=@superserve/sdk

# Adding dependencies — always from repo root with --filter
bun add zod --filter @superserve/cli
bun add -d @types/node --filter @superserve/sdk
# Never cd into a package and run bun add (creates a conflicting lockfile)

# Testing the CLI locally (no dev server, run directly)
bun packages/cli/src/index.ts deploy --help

# Python SDK
uv run pytest packages/python-sdk/tests/           # Run SDK tests
uv run ruff check packages/python-sdk/ --fix        # Lint
uv run mypy packages/python-sdk/src/superserve/     # Type check

# Python via Turborepo
bunx turbo run test --filter=@superserve/python-sdk
bunx turbo run lint --filter=@superserve/python-sdk
```

## Coding Style

### TypeScript
- Biome for linting and formatting (2-space indent, double quotes, semicolons as needed)
- TypeScript strict mode
- ESM modules

### Python
- Python 3.12+, type hints on function signatures
- Ruff for linting and formatting (line length 88)

### General
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

## Planning

- Save all planning and implementation documents to `spec/` (not `docs/plans/`)
