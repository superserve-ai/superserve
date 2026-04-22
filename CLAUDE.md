# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

Superserve provides sandbox infrastructure to run code in isolated cloud environments powered by Firecracker MicroVMs. Users create sandboxes via the console, CLI, or SDK, execute commands, upload/download files, and manage sandbox lifecycle (pause/resume/delete).

This repo is a monorepo containing the console, CLI, TypeScript SDK, Python SDK, and UI library.

## Monorepo Structure

```
superserve/
├── apps/
│   ├── console/                 # Next.js 16 console app (App Router)
│   └── ui-docs/                 # UI component documentation (Vite, port 3003)
├── packages/
│   ├── cli/                     # TypeScript CLI (@superserve/cli on npm)
│   ├── python-sdk/              # Python SDK (superserve on PyPI) — hand-crafted
│   ├── sdk/                     # TypeScript SDK (@superserve/sdk on npm) — hand-crafted
│   ├── ui/                      # Shared UI component library (@superserve/ui)
│   ├── supabase/                # Supabase client factories (browser/server/admin/middleware)
│   ├── typescript-config/       # Shared tsconfig presets
│   └── tailwind-config/         # Shared Tailwind CSS config
├── tests/
│   ├── sdk-e2e-ts/              # TypeScript SDK end-to-end tests (Vitest)
│   └── sdk-e2e-py/              # Python SDK end-to-end tests (pytest)
├── docs/                        # Mintlify docs site (docs.json, MDX pages)
├── spec/                        # Planning and implementation documents
└── examples/                    # Example projects
```

**Workspace tooling:**
- **Bun workspaces** for dependency management (single `bun.lock` at root; workspaces: `apps/*`, `packages/*`, `tests/*`)
- **Turborepo** for task orchestration (build, lint, typecheck, test, e2e)
- **uv workspaces** for Python packages (`pyproject.toml` at root as workspace root)

## Architecture

### Console (`apps/console/`)

Next.js 16 App Router application with Supabase auth. Key architectural patterns:

**API Proxy** (`src/app/api/[...path]/route.ts`): All sandbox API calls from the browser go through a Next.js API route that authenticates the user via Supabase session, generates a server-side `X-API-Key`, and forwards the request to the platform API (`SANDBOX_API_URL`). The proxy key is cached for 24 hours per user.

**Server Actions** (`src/lib/api/*-actions.ts`): API keys, snapshots, activity, and audit logs are fetched directly via Supabase admin client in server actions, bypassing the proxy.

**Data Fetching**: React Query (TanStack Query) with custom hooks (`src/hooks/`). Mutations use optimistic updates. Query keys are centralized in `src/lib/api/query-keys.ts`.

**Auth**: Supabase Auth with Google OAuth and email/password. The proxy file (`src/proxy.ts`) handles route protection. Internal proxy API keys use the `__console_proxy__` name and are hidden from the UI.

**Analytics**: PostHog for event tracking. Events are defined in `src/lib/posthog/events.ts`.

### UI Library (`packages/ui/`)

Built on **@base-ui/react** (headless components) + Tailwind CSS + **motion** (Framer Motion) for animations. Component animations use CSS transitions with `data-starting-style`/`data-ending-style` attributes (defined in `packages/ui/src/styles/globals.css`). Icons from `@phosphor-icons/react`. Code highlighting via `shiki`.

### TypeScript CLI (`packages/cli/`)

Built with Bun + Commander. Entry point: `src/index.ts`. Authenticates via device flow or API key.

### TypeScript SDK (`packages/sdk/`) — v0.6.0

Published as `@superserve/sdk`. Hand-crafted SDK. Zero runtime dependencies (uses native `fetch`).

**Main API:**
- `Sandbox.create({ name })` / `Sandbox.connect(id)` / `Sandbox.list()` / `Sandbox.killById(id)`
- Instance: `sandbox.pause()` / `resume()` / `kill()` / `update()` / `getInfo()`
- Sub-modules: `sandbox.commands.run(cmd, opts)`, `sandbox.files.write/read/readText(path, ...)`
- Call `sandbox.kill()` or `Sandbox.killById(id)` to delete a sandbox — no `Symbol.asyncDispose` / `await using`

**Design choices:**
- `status` / `metadata` are `readonly` snapshots from construction — call `getInfo()` for fresh data
- `access_token` is private to the Sandbox instance (not exposed in `SandboxInfo`); rotated automatically on `resume()` and re-injected into the `files` sub-module
- `kill()` is idempotent (swallows 404)
- `pause()` / `resume()` / `kill()` return `void` (no body); `getInfo()` / `list()` / `get()` return `SandboxInfo`
- Every network op accepts `AbortSignal`; GET/DELETE requests auto-retry transient errors (429, 5xx, network) with exponential backoff + jitter
- Streaming `run()` uses idle timeout (resets on each SSE chunk); throws if stream ends without a `finished` event
- `toSandboxInfo` throws on missing `id` / `status`; `create()` / `connect()` / `resume()` throw on missing `access_token`
- Typed errors: `SandboxError`, `AuthenticationError`, `ValidationError`, `NotFoundError`, `ConflictError`, `TimeoutError`, `ServerError`

### Python SDK (`packages/python-sdk/`) — v0.6.0

Published as `superserve` on PyPI. Hand-crafted SDK. Runtime deps: `httpx>=0.24.0`, `pydantic>=2.0.0`, `typing-extensions>=4.0.0`. Supports Python ≥ 3.9.

Same API surface as TypeScript SDK (snake_case). `Sandbox` (sync) and `AsyncSandbox` (async) classes.

**Design choices:**
- No context manager (`with`/`async with`); call `sandbox.kill()` / `Sandbox.kill_by_id(id)` explicitly
- `TimeoutError` is named `SandboxTimeoutError` to avoid shadowing Python's builtin
- `kill()` is idempotent; `pause()` / `resume()` / `kill()` return `None`
- Shared `httpx.Client` per Sandbox instance (connection pooling) — closed on `kill()` / `__exit__`
- `access_token` is private (`_access_token`); rotated on `resume()` and re-injected into the `files` sub-module
- Typed errors match TS hierarchy (with `SandboxTimeoutError` rename)

## Key Patterns

- **Sandbox IDs**: UUIDs. API keys prefixed with `ss_live_`.
- **Sandbox lifecycle**: `active ↔ paused → deleted`. Only two user-visible states — `active` (running) and `paused`. Create is synchronous; `POST /pause` returns 204; `POST /resume` rotates the per-sandbox access token (SDK updates the files sub-module transparently). Exec on a `paused` sandbox is transparently resumed by the platform before execution — callers do not need to `resume()` first.
- **Data plane vs control plane**: SDK hides this internally. Control plane is `api.superserve.ai` (API key). Data plane is `boxd-{id}.sandbox.superserve.ai` (access token). Users never construct data-plane URLs.
- **API types**: Defined in `apps/console/src/lib/api/types.ts`. Must match the OpenAPI spec.
- **Shared configs**: TypeScript projects extend from `@superserve/typescript-config`. Tailwind from `@superserve/tailwind-config`. Biome is a single root `biome.json` that covers every workspace (Biome 2.x) — no per-package Biome config.
- **Sticky hover animation**: Reusable pattern across sidebar, command palette, table bodies, and language tabs using `motion` `layoutId` for smooth hover transitions.

## Development

### Setup

```bash
bun install              # install all JS/TS deps
uv sync                  # install all Python deps
```

### All packages (from repo root)

```bash
bun run dev              # start all dev servers
bun run build            # build everything in dependency order
bun run lint             # lint all packages
bun run typecheck        # type check all packages
bun run test             # unit/integration tests (Vitest, no credentials)
bun run test:coverage    # tests with coverage
bun run test:e2e         # SDK e2e tests (requires SUPERSERVE_API_KEY)
```

### Target a specific package

```bash
bunx turbo run dev --filter=@superserve/console
bunx turbo run build --filter=@superserve/sdk
bunx turbo run typecheck --filter=@superserve/sdk
bunx turbo run test --filter=@superserve/console -- <pattern>   # Vitest filter
```

### Adding dependencies

```bash
bun add zod --filter @superserve/cli
bun add -d @types/node --filter @superserve/sdk
```

Never `cd` into a package and run `bun add` — creates a conflicting lockfile.

### Testing the CLI locally

```bash
bun packages/cli/src/index.ts deploy --help
```

### Email templates (React Email)

```bash
bun --filter @superserve/console run email:dev
# preview server at http://localhost:3002
# templates live at apps/console/src/lib/email/templates/*.tsx
```

### Python SDK

```bash
uv run pytest packages/python-sdk/tests/                           # run tests
uv run pytest packages/python-sdk/tests/test_file.py::test_name    # single test
uv run ruff check packages/python-sdk/ --fix                       # lint
uv run mypy packages/python-sdk/src/superserve/                    # type check

# via Turborepo
bunx turbo run test --filter=@superserve/python-sdk
bunx turbo run lint --filter=@superserve/python-sdk
bunx turbo run typecheck --filter=@superserve/python-sdk
```

### E2E tests (credentialed)

```bash
SUPERSERVE_API_KEY=ss_live_... bun run test:e2e                   # both languages
SUPERSERVE_API_KEY=ss_live_... bunx turbo run e2e --filter=@superserve/test-sdk-e2e-ts
SUPERSERVE_API_KEY=ss_live_... bunx turbo run e2e --filter=@superserve/test-sdk-e2e-py

# override target environment
SUPERSERVE_BASE_URL=https://api.superserve.ai SUPERSERVE_API_KEY=... bun run test:e2e
```

Without `SUPERSERVE_API_KEY`, all e2e tests skip cleanly.

### Docs (Mintlify)

```bash
bun run docs:dev         # local Mintlify dev server
bun run docs:build       # validate docs build
```

Docs live in `docs/` — `docs.json` is the navigation config. SDK reference pages under `docs/sdk/{typescript,python}/`. Deployed by Mintlify on push to `main`.

### Releasing SDKs

**Version bumps** — both SDKs should be kept in sync:
- TS: `packages/sdk/package.json` → `version`
- Python: `packages/python-sdk/pyproject.toml` → `version` AND `packages/python-sdk/src/superserve/__init__.py` → `__version__` (keep them identical)

**Publish TS to npm:**
```bash
bunx turbo run build --filter=@superserve/sdk
cd packages/sdk && bun publish --access public
```

**Publish Python to PyPI** — run `uv build` from **repo root** (uv workspaces put artifacts in root `dist/`):
```bash
uv build --package superserve
uv publish dist/superserve-*
```

Or use the **Release SDKs** GitHub Actions workflow (manual `workflow_dispatch` with `package` and `version` inputs).

## Coding Style

### TypeScript
- Biome for linting and formatting (2-space indent, double quotes, semicolons as needed)
- TypeScript strict mode, ESM modules
- Run `bunx biome check --write .` from the package directory to auto-fix lint/format issues

### Python
- Python ≥ 3.9 (SDK target); repo uses 3.12 locally (see `.python-version`)
- Type hints on function signatures
- Ruff for linting and formatting (line length 88)

## Design Language

The console has a deliberate austere, technical aesthetic. Follow these patterns when building UI:

**Color & Theme**: Dark monochromatic palette (`#0a0a0a` background, `#e5e5e5` foreground, `#171717` surfaces). Color is reserved for status indicators only (green/red/orange). Tokens are in `packages/tailwind-config/theme.css`.

**Borders**: Dashed borders everywhere — dialogs, cards, buttons (outline variant), separators, inputs. Use `border border-dashed border-border`. This is the signature visual trait. No solid decorative borders.

**Typography**: Instrument Sans (sans) + Geist Mono (mono). Buttons, badges, and table headers use `font-mono uppercase text-xs`. Body text uses sans.

**Corners**: Sharp corners throughout, no border-radius. This reinforces the technical feel.

**Corner Brackets**: A custom decorative element (`<CornerBrackets />`) that frames active/selected items with small L-shaped corner marks. Used in sidebar nav, language tabs, empty states, and command palette. Sizes: `sm`, `md`, `lg`.

**Animations**: Scale-based transitions (0.96x → 1x) for dialogs and popovers. Spring-based sticky hover (`layoutId` with `motion`) for nav items, table rows, tabs, and command palette items. Defined in `packages/ui/src/styles/globals.css`.

**Layout**: Dashboard uses a collapsible sidebar (16px collapsed, 64px expanded) + full-height content. Pages follow: `PageHeader` (h-14) → optional `TableToolbar` → scrollable content. Settings pages use a `grid-cols-[240px_1fr]` two-column layout.

**Icons**: Phosphor Icons with `weight="light"` consistently. Size `size-4` for inline, `size-3.5` for buttons.

## Branding

- CLI tool is `superserve`, platform is `Superserve`
- Never use "Claude" standalone — use "Claude Agent" or "Claude Agent SDK"

## Git

- Single-line commit messages
- Do not include "Co-Authored-By" or AI attribution in commits

## Planning

- Save all planning and implementation documents to `spec/` (not `docs/plans/`)
