<div align="center">
  <br/>
  <br/>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/superserve-ai/superserve/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/superserve-ai/superserve/main/assets/logo-light.svg">
  </picture>

  <br/>
  <br/>

  <p><strong>Sandbox infrastructure to run AI Agents in the cloud. Powered by Firecracker MicroVMs.</strong></p>

  [![Docs](https://img.shields.io/badge/Docs-latest-blue)](https://docs.superserve.ai/)
  [![License](https://img.shields.io/badge/License-OCVSAL_1.0-blue.svg)](https://github.com/superserve-ai/superserve/blob/main/LICENSE)

</div>

> [!WARNING]
> This repo is a work in progress. Things may break, change significantly, or not work at all.

## Getting Started

Visit our website to get started: [superserve.ai](https://www.superserve.ai/)

## Structure

```
apps/
  console/                 # Sandbox Dashboard
  playground/              # React + Vite playground app
  ui-docs/                 # UI component docs
packages/
  cli/                     # TypeScript CLI (@superserve/cli)
  python-sdk/              # Python SDK (superserve on PyPI)
  sdk/                     # TypeScript SDK (@superserve/sdk)
  ui/                      # Shared UI components
  supabase/                # Supabase config and migrations
  typescript-config/       # Shared tsconfig presets
  tailwind-config/         # Shared Tailwind config
  biome-config/            # Shared Biome config
docs/                      # Mintlify documentation
```

## Development

This repo is a monorepo managed with [Bun workspaces](https://bun.sh/docs/install/workspaces) and [Turborepo](https://turbo.build/repo).

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
bunx turbo run dev --filter=@superserve/console
bunx turbo run build --filter=@superserve/sdk
```

### Adding Dependencies

Always add dependencies from the repo root using `--filter`:

```bash
bun add zod --filter @superserve/cli
bun add react --filter @superserve/console
bun add -d @types/node --filter @superserve/sdk
```

> **Note:** Do not `cd` into a package directory and run `bun add` directly - this creates a separate `bun.lock` that conflicts with the monorepo's root lockfile.

### Python SDK

The Python SDK lives in `packages/python-sdk/` and is managed with **uv workspaces**:

```bash
uv sync                                              # install Python dependencies
uv run pytest packages/python-sdk/tests/              # run tests
uv run ruff check packages/python-sdk/                # lint
uv run mypy packages/python-sdk/src/superserve/       # type check
```

## Where to find us

- [Email us](mailto:engineering@superserve.ai)
- [Twitter/X](https://x.com/superserve_ai)
- [LinkedIn](https://www.linkedin.com/company/super-serve-ai)

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](https://github.com/superserve-ai/superserve/blob/main/CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Open Core Ventures Source Available License (OCVSAL) 1.0 - see the [LICENSE](https://github.com/superserve-ai/superserve/blob/main/LICENSE) file for details.
