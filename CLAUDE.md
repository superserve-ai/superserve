# CLAUDE.md

Guidelines for working with the Superserve monorepo.

## What This Repository Is

Superserve is a sandbox and VM platform built on Firecracker micro-VMs. It provides a CLI, TypeScript SDK, and Python SDK for creating isolated cloud VMs with checkpoint, rollback, and fork primitives. The API is at `api.agentbox.dev/v1`.

This repo is a monorepo containing the CLI, TypeScript SDK, Python SDK, and documentation.

## Monorepo Structure

```
superserve/
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

Built with Bun + Commander. Entry point: `src/index.ts`. Provides commands for VM lifecycle management (`vm create`, `vm exec`, `vm checkpoint`, `vm fork`), file operations, and authentication.

### TypeScript SDK (`packages/sdk/`)

Published as `@superserve/sdk` with dual CJS/ESM output via tsup. Exposes the `Superserve` client with namespaced APIs: `vms`, `files`, and `checkpoints`.

### Python SDK (`packages/python-sdk/`)

Published as `superserve` on PyPI. httpx-based client SDK providing the `Superserve` client with `vms`, `files`, and `checkpoints` namespaces.

## Key Patterns

- **VM IDs**: Prefixed with `vm_`, checkpoint IDs with `cp_`.
- **SSE streaming**: Command execution streams output via Server-Sent Events. Events include `stdout`, `stderr`, `exit`, `error`.
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
bunx turbo run dev --filter=@superserve/playground
bunx turbo run build --filter=@superserve/sdk

# Adding dependencies — always from repo root with --filter
bun add zod --filter @superserve/cli
bun add -d @types/node --filter @superserve/sdk
# Never cd into a package and run bun add (creates a conflicting lockfile)

# Testing the CLI locally (no dev server, run directly)
bun packages/cli/src/index.ts vm --help

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
- Internal infra names (e.g. `claude-runtime-template`) are fine but should migrate over time

## Git

- Single-line commit messages
- Do not include "Co-Authored-By" or AI attribution in commits

## Planning

- Save all planning and implementation documents to `spec/` (not `docs/plans/`)
