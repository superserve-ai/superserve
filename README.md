<div align="center">
  <br/>
  <br/>
  <picture>
    <img width="1500" height="auto" alt="Twitter Header - Personal" src="https://github.com/user-attachments/assets/565a469e-bc80-4e0a-af70-4e6ed07975c2" />
  </picture>

  <br/>
  <br/>

  <p><strong>Sandbox infrastructure to run AI Agents in the cloud. Powered by Firecracker MicroVMs.</strong></p>

  [![Docs](https://img.shields.io/badge/Docs-latest-blue)](https://docs.superserve.ai/)
  [![License](https://img.shields.io/badge/license-Apache%20License%202.0-blue)](https://github.com/superserve-ai/superserve/blob/main/LICENSE)

</div>

> [!Note]
> **Beta Release**: This project is in beta and under active development. We welcome feedback but cannot guarantee backwards compatibility at this time.

## Getting Started

Visit [superserve.ai](https://www.superserve.ai/) or jump straight into the [docs](https://docs.superserve.ai/).

## Structure

```
apps/
  console/                 # Sandbox Dashboard (Next.js 16, App Router)
  ui-docs/                 # UI component docs (Vite)
packages/
  cli/                     # TypeScript CLI (@superserve/cli)
  python-sdk/              # Python SDK (superserve on PyPI) — hand-crafted
  sdk/                     # TypeScript SDK (@superserve/sdk on npm) — hand-crafted
  ui/                      # Shared UI components (@superserve/ui)
  supabase/                # Supabase client factories
  typescript-config/       # Shared tsconfig presets
  tailwind-config/         # Shared Tailwind config
  biome-config/            # Shared Biome config
docs/                      # Mintlify documentation site
tests/
  sdk-e2e-ts/              # TypeScript SDK e2e tests (Vitest)
  sdk-e2e-py/              # Python SDK e2e tests (pytest)
spec/                      # Planning and design documents
```

## Setup

This repo is a monorepo managed with [Bun workspaces](https://bun.sh/docs/install/workspaces), [Turborepo](https://turbo.build/repo), and [uv workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/).

```bash
bun install               # install all JS/TS dependencies
uv sync                   # install all Python dependencies
```

## Development

### All packages

Run tasks across every package from the repo root:

```bash
bun run dev               # start all dev servers
bun run build             # build all packages
bun run lint              # lint all packages
bun run typecheck         # type check all packages
bun run test              # unit/integration tests (fast, no credentials)
bun run test:coverage     # unit tests with coverage
```

### Target a specific package

```bash
bunx turbo run dev --filter=@superserve/console
bunx turbo run build --filter=@superserve/sdk
bunx turbo run test --filter=@superserve/console -- <pattern>   # vitest filter
```

### Adding dependencies

Always add dependencies from the repo root using `--filter`:

```bash
bun add zod --filter @superserve/cli
bun add react --filter @superserve/console
bun add -d @types/node --filter @superserve/sdk
```

> **Note:** Do not `cd` into a package directory and run `bun add` — it creates a separate `bun.lock` that conflicts with the monorepo's root lockfile.

## SDKs

Both SDKs are hand-crafted (not code-generated). Current version: **0.6.0**.

### TypeScript SDK — `@superserve/sdk`

```typescript
import { Sandbox } from "@superserve/sdk"

const sandbox = await Sandbox.create({ name: "my-sandbox" })
await sandbox.waitForReady()

const result = await sandbox.commands.run("echo hello")
console.log(result.stdout)

await sandbox.files.write("/app/data.txt", "content")
const text = await sandbox.files.readText("/app/data.txt")

await sandbox.kill()
```

Use `await using sandbox = await Sandbox.create({ name: "..." })` for auto-cleanup.

**Build / typecheck:**
```bash
bunx turbo run build --filter=@superserve/sdk
bunx turbo run typecheck --filter=@superserve/sdk
```

### Python SDK — `superserve`

```python
from superserve import Sandbox

with Sandbox.create(name="my-sandbox") as sandbox:
    sandbox.wait_for_ready()
    result = sandbox.commands.run("echo hello")
    print(result.stdout)

    sandbox.files.write("/app/data.txt", b"content")
    text = sandbox.files.read_text("/app/data.txt")
# sandbox.kill() runs automatically
```

Async variant: `AsyncSandbox` with `async with` support.

**Build / typecheck / lint:**
```bash
bunx turbo run build --filter=@superserve/python-sdk
bunx turbo run typecheck --filter=@superserve/python-sdk
bunx turbo run lint --filter=@superserve/python-sdk
```

## Testing

### Unit tests (no credentials)

```bash
bun run test
```

### E2E tests (credentialed, hits live API)

```bash
SUPERSERVE_API_KEY=ss_live_... bun run test:e2e
```

Defaults to staging. Override with `SUPERSERVE_BASE_URL`:

```bash
# Production
SUPERSERVE_API_KEY=ss_live_... \
  SUPERSERVE_BASE_URL=https://api.superserve.ai \
  bun run test:e2e

# Local backend
SUPERSERVE_API_KEY=ss_dev_... \
  SUPERSERVE_BASE_URL=http://localhost:8080 \
  bun run test:e2e
```

Run just one language:

```bash
SUPERSERVE_API_KEY=ss_live_... bunx turbo run e2e --filter=@superserve/test-sdk-e2e-ts
SUPERSERVE_API_KEY=ss_live_... bunx turbo run e2e --filter=@superserve/test-sdk-e2e-py
```

Without `SUPERSERVE_API_KEY`, all e2e tests skip cleanly (exit 0).

### Coverage

| Suite | Files | What it covers |
|---|---|---|
| TS e2e | `tests/sdk-e2e-ts/tests/{sandboxes,exec,files}.test.ts` | lifecycle (create/get/list/update/pause/resume/delete), sync + streaming exec, file write/read |
| Python e2e | `tests/sdk-e2e-py/test_{sandboxes,exec,files,async}.py` | same as TS + AsyncSandbox smoke test |
| Console unit | `apps/console/src/**/*.test.{ts,tsx}` | auth flows, components, API proxy |
| CLI unit | `packages/cli/tests/**` | config validation, deploy logic |

## Docs (Mintlify)

The documentation site at [docs.superserve.ai](https://docs.superserve.ai/) is built with [Mintlify](https://mintlify.com) from the `docs/` directory.

```bash
bun run docs:dev          # local dev server, hot-reloads MDX changes
bun run docs:build        # validate the docs build
```

Navigation is configured in `docs/docs.json`. SDK reference pages live under `docs/sdk/{typescript,python}/`.

Deployment is handled by Mintlify on push to `main` (no manual publish step).

## Releasing

### TypeScript SDK to npm

From the repo root:

```bash
# 1. Bump packages/sdk/package.json version
# 2. Build + publish
bunx turbo run build --filter=@superserve/sdk
cd packages/sdk
NPM_CONFIG_TOKEN=npm_... bun publish --access public
```

Or with `.env.release` sourced:
```bash
source .env.release
bunx turbo run build --filter=@superserve/sdk
cd packages/sdk && bun publish --access public
```

### Python SDK to PyPI

**Important:** `uv build` must run from the **repo root** (uv workspaces put artifacts in root `dist/`). Bump the version in three places:

1. `packages/python-sdk/pyproject.toml` → `version = "..."`
2. `packages/python-sdk/src/superserve/__init__.py` → `__version__ = "..."`

```bash
uv build --package superserve
UV_PUBLISH_TOKEN=pypi-... uv publish dist/superserve-<version>*
```

Or with `.env.release` sourced:
```bash
source .env.release
uv build --package superserve
uv publish dist/superserve-*
```

### Release environment setup

Copy `.env.release.example` to `.env.release`, fill in tokens, and `source` it before running publish commands. `.env.release` is gitignored.

| Env variable | Used by | How to get it |
|---|---|---|
| `NPM_CONFIG_TOKEN` | `bun publish` (TS SDK) | [npmjs.com](https://www.npmjs.com) → account → access tokens → automation token |
| `UV_PUBLISH_TOKEN` | `uv publish` (Python SDK) | [pypi.org](https://pypi.org/manage/account/) → account → API tokens (starts with `pypi-`) |

### CI workflow (GitHub Actions)

| Workflow | Trigger | Action |
|---|---|---|
| **Release SDKs** | Manual (`workflow_dispatch`) | Bumps version, builds, publishes to npm and/or PyPI, commits + tags. Inputs: `package` (`ts` / `python` / `both`), `version`. |

Required repo secrets:

| Secret | Used by |
|---|---|
| `NPM_TOKEN` | Release SDKs (ts) |
| `PYPI_TOKEN` | Release SDKs (python) |

## Quick reference

| Task | Command |
|---|---|
| Install deps | `bun install && uv sync` |
| Dev (all) | `bun run dev` |
| Build (all) | `bun run build` |
| Lint | `bun run lint` |
| Typecheck | `bun run typecheck` |
| Unit tests | `bun run test` |
| E2E tests | `SUPERSERVE_API_KEY=... bun run test:e2e` |
| Docs dev | `bun run docs:dev` |
| Docs build | `bun run docs:build` |
| Build TS SDK | `bunx turbo run build --filter=@superserve/sdk` |
| Build Python SDK | `uv build --package superserve` (from repo root) |
| Publish TS SDK | `cd packages/sdk && bun publish --access public` |
| Publish Python SDK | `uv publish dist/superserve-*` (from repo root) |

## Where to find us

- [Email us](mailto:engineering@superserve.ai)
- [Twitter/X](https://x.com/superserve_ai)
- [LinkedIn](https://www.linkedin.com/company/super-serve-ai)

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](https://github.com/superserve-ai/superserve/blob/main/CONTRIBUTING.md) for guidelines.

## License

Apache License 2.0 — see the [LICENSE](https://github.com/superserve-ai/superserve/blob/main/LICENSE) file for details.
