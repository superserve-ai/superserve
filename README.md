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

Visit our website to get started: [superserve.ai](https://www.superserve.ai/)

## Structure

```
apps/
  console/                 # Sandbox Dashboard (Next.js)
  ui-docs/                 # UI component docs (Vite)
packages/
  cli/                     # TypeScript CLI (@superserve/cli)
  python-sdk/              # Python SDK (superserve on PyPI)
  sdk/                     # TypeScript SDK (@superserve/sdk on npm)
  ui/                      # Shared UI components
  supabase/                # Supabase client factories
  typescript-config/       # Shared tsconfig presets
  tailwind-config/         # Shared Tailwind config
  biome-config/            # Shared Biome config
docs/                      # Documentation (Mintlify)
tests/
  sdk-e2e-ts/              # TypeScript SDK e2e tests (Vitest)
  sdk-e2e-py/              # Python SDK e2e tests (pytest)
spec/                      # Planning and design documents
```

## Development

This repo is a monorepo managed with [Bun workspaces](https://bun.sh/docs/install/workspaces), [Turborepo](https://turbo.build/repo), and [uv workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/) (for Python).

### Setup

```bash
bun install               # install all JS/TS dependencies
uv sync                   # install all Python dependencies
```

### Day-to-day commands

Run tasks across all packages from the repo root:

```bash
bun run build             # build all packages
bun run dev               # start all dev servers
bun run lint              # lint all packages
bun run typecheck         # type check all packages
bun run test              # run all unit/integration tests (fast, no credentials needed)
```

Target a specific package with `--filter`:

```bash
bunx turbo run dev --filter=@superserve/console
bunx turbo run build --filter=@superserve/sdk
```

### Adding dependencies

Always add dependencies from the repo root using `--filter`:

```bash
bun add zod --filter @superserve/cli
bun add react --filter @superserve/console
bun add -d @types/node --filter @superserve/sdk
```

> **Note:** Do not `cd` into a package directory and run `bun add` directly — this creates a separate `bun.lock` that conflicts with the monorepo's root lockfile.

## SDKs

The Superserve SDKs are hand-crafted TypeScript and Python packages.

### TypeScript SDK (`@superserve/sdk`)

```typescript
import { Sandbox } from "@superserve/sdk"

const sandbox = await Sandbox.create({ name: "my-sandbox" })
await sandbox.waitForReady()

const result = await sandbox.commands.run("echo hello")
console.log(result.stdout)

await sandbox.files.write("/app/data.txt", "content")
await sandbox.kill()
```

### Python SDK (`superserve`)

```python
from superserve import Sandbox

sandbox = Sandbox.create(name="my-sandbox")
sandbox.wait_for_ready()

result = sandbox.commands.run("echo hello")
print(result.stdout)

sandbox.files.write("/app/data.txt", b"content")
sandbox.kill()
```

### Publishing the TypeScript SDK to npm

```bash
cd packages/sdk
# bump `version` in package.json
bun run build
NPM_CONFIG_TOKEN=npm_... bun publish --access public
```

### Publishing the Python SDK to PyPI

From the **repo root** (not from `packages/python-sdk/`):

```bash
uv build --package superserve
UV_PUBLISH_TOKEN=pypi-... uv publish dist/superserve-<version>*
```

## Docs

Documentation is built with [Mintlify](https://mintlify.com) from the `docs/` directory.

```bash
bun run docs:dev           # start local Mintlify dev server
bun run docs:build         # build docs
```

### Release environment setup

For manual releases from your laptop, copy `.env.release.example` to `.env.release`, fill in the tokens, and `source` it before running any publish command. `.env.release` is gitignored.

| Env variable | Used by | How to get it |
|---|---|---|
| `NPM_CONFIG_TOKEN` | `bun publish` (TS SDK) | [npmjs.com](https://www.npmjs.com) → account settings → access tokens → generate automation token |
| `UV_PUBLISH_TOKEN` | `uv publish` (Python SDK) | [pypi.org](https://pypi.org/manage/account/) → account settings → API tokens → add token (starts with `pypi-`) |

### CI workflows (GitHub Actions)

| Workflow | What it does |
|---|---|
| **Release SDKs** | Bumps version, builds, publishes to npm and/or PyPI, commits + tags. Inputs: `package` (`ts` / `python` / `both`), `version` |

Required repo secrets:

| Secret | Workflow |
|---|---|
| `NPM_TOKEN` | Release SDKs (ts) |
| `PYPI_TOKEN` | Release SDKs (python) |

## Testing

### Unit / integration tests (fast, no credentials)

```bash
bun run test               # runs all unit tests via turbo (console, cli, sdk)
```

### End-to-end tests (credentialed, hits live API)

```bash
SUPERSERVE_API_KEY=ss_live_... bun run test:e2e
```

Runs both the TypeScript (Vitest) and Python (pytest) e2e suites against a live Superserve environment. Defaults to staging; override with `SUPERSERVE_BASE_URL`:

```bash
SUPERSERVE_API_KEY=ss_live_... SUPERSERVE_BASE_URL=https://api.superserve.ai bun run test:e2e
```

Run just one language:

```bash
SUPERSERVE_API_KEY=ss_live_... bunx turbo run e2e --filter=@superserve/test-sdk-e2e-ts
SUPERSERVE_API_KEY=ss_live_... bunx turbo run e2e --filter=@superserve/test-sdk-e2e-py
```

Without `SUPERSERVE_API_KEY`, all e2e tests skip cleanly (exit 0).

### Coverage

| Suite | Test files | What it covers |
|---|---|---|
| TS e2e | `tests/sdk-e2e-ts/tests/{sandboxes,exec,files}.test.ts` | create/get/list/update/pause/resume/delete sandboxes, sync + streaming exec, file write/read |
| Python e2e | `tests/sdk-e2e-py/test_{sandboxes,exec,files}.py` | same as TS |
| Console unit | `apps/console/src/**/*.test.{ts,tsx}` | auth flows, components, API proxy |
| CLI unit | `packages/cli/tests/**` | config validation, deploy logic |

## Quick reference

| Task | Command |
|---|---|
| Install all deps | `bun install && uv sync` |
| Build everything | `bun run build` |
| Run all dev servers | `bun run dev` |
| Lint | `bun run lint` |
| Typecheck | `bun run typecheck` |
| Unit tests | `bun run test` |
| E2e tests | `SUPERSERVE_API_KEY=... bun run test:e2e` |
| Preview docs | `bun run docs:dev` |
| Publish TS SDK | `cd packages/sdk && bun run build && bun publish --access public` |
| Publish Python SDK | `uv build --package superserve && uv publish dist/superserve-*` |

## Where to find us

- [Email us](mailto:engineering@superserve.ai)
- [Twitter/X](https://x.com/superserve_ai)
- [LinkedIn](https://www.linkedin.com/company/super-serve-ai)

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](https://github.com/superserve-ai/superserve/blob/main/CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Open Core Ventures Source Available License (OCVSAL) 1.0 - see the [LICENSE](https://github.com/superserve-ai/superserve/blob/main/LICENSE) file for details.
