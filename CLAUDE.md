# CLAUDE.md

Superserve provides sandbox infrastructure (Firecracker microVMs) to run code in isolated cloud environments. This monorepo contains the console, CLI, TypeScript SDK, Python SDK, MCP server, and UI library.

For SDK usage, product concepts, and API reference, see [docs.superserve.ai](https://docs.superserve.ai) (LLM-friendly: `docs.superserve.ai/llms-full.txt`). The `superserve` skill contains the full SDK reference.

## Monorepo structure

```
apps/console/          # Next.js 16 console (App Router)
apps/ui-docs/          # UI component docs (Vite, port 3003)
packages/cli/          # TypeScript CLI (@superserve/cli)
packages/sdk/          # TypeScript SDK (@superserve/sdk)
packages/python-sdk/   # Python SDK (superserve on PyPI)
packages/ui/           # Shared UI component library (@superserve/ui)
packages/mcp/          # MCP server (@superserve/mcp)
tests/                 # SDK e2e tests (sdk-e2e-ts, sdk-e2e-py)
docs/                  # Mintlify site (docs.json)
```

Bun workspaces + Turborepo for JS/TS. uv workspaces for Python.

## Development

```bash
bun install && uv sync                              # setup
bun run dev / build / lint / format / typecheck / test
SUPERSERVE_API_KEY=ss_live_... bun run test:e2e     # credentialed SDK e2e
bunx turbo run build --filter=@superserve/sdk       # target a package
bun run docs:dev                                    # Mintlify preview
```

**Adding deps:** `bun add zod --filter @superserve/console` — never `cd` into a package then `bun add`, it creates a conflicting lockfile. The CLI bundles everything into `dist/index.js`, so its deps go in devDependencies (`bun add -d`).

**CLI locally:** `bun packages/cli/src/index.ts sandbox --help` · bundle: `bunx turbo run build --filter=@superserve/cli && node packages/cli/dist/index.js --help` · release: push a `cli-vX.Y.Z` tag

**Python SDK:** `uv run pytest packages/python-sdk/tests/` · `uv run ruff check --fix packages/python-sdk tests/sdk-e2e-py` · `uv run ruff format packages/python-sdk tests/sdk-e2e-py` · `uv run mypy packages/python-sdk/src/superserve/`

**Lint/format fix:** `bun run format` runs `oxfmt --write` inside each workspace that defines a `format` script, which is the same scope CI's `format:check` enforces. `packages/tailwind-config`, `packages/typescript-config` and `tests/sdk-e2e-ts` define neither it nor `format:check`, so give oxfmt explicit paths there; the two Python workspaces are ruff's (above — `check --fix` lints, `format` formats), and nothing formats their Markdown or JSON. `bun run lint` only reports; for autofixes run `bunx oxlint --fix` against the paths you changed.

Don't run `bunx oxfmt --write` from the repo root with no path argument: `docs/`, `guides/`, and the root config files sit outside every workspace, so it reformats ~65 files that `turbo run format:check` never looks at and CI never enforces. The pre-commit hook formats whatever is staged wherever it lives, so staging those files introduces the same drift.

## Releasing SDKs

Keep TS and Python version numbers in sync:

- TS: `packages/sdk/package.json` → `version`
- Python: `packages/python-sdk/pyproject.toml` → `version` AND `packages/python-sdk/src/superserve/__init__.py` → `__version__`

Prefer the **Release SDKs** GitHub Actions workflow (`workflow_dispatch`). For manual publish:

- TS: `bunx turbo run build --filter=@superserve/sdk && cd packages/sdk && bun publish --access public`
- Python: run `uv build --package superserve && uv publish dist/superserve-*` from repo root (uv workspaces put artifacts there)

## API reference docs

The docs API reference (`docs/docs.json` → `openapi`) loads the spec from https://api.superserve.ai/openapi.yaml. That file is `api/openapi.yaml` in the sandbox repo, served without credentials, so it is public. Review every change to it, and every docs page or snippet derived from it, as public: no internal endpoints (`/internal/**`), secrets, tokens, internal hostnames/IPs, infra details, or other sensitive data. `bun run docs:check-nav` checks the docs nav against that URL.

## Console architecture

**API Proxy** (`apps/console/src/app/api/[...path]/route.ts`): All browser sandbox API calls route through a Next.js proxy that authenticates via Supabase session, generates a server-side `X-API-Key`, and forwards to `SANDBOX_API_URL`. Proxy keys use the name `__console_proxy__` and are hidden from the UI.

**Server Actions** (`apps/console/src/lib/api/*-actions.ts`): API keys, snapshots, activity, and audit logs use the Supabase admin client directly, bypassing the proxy.

**Data fetching:** React Query with hooks in `src/hooks/`. Query keys in `src/lib/api/query-keys.ts`. Mutations use optimistic updates.

**API types:** `apps/console/src/lib/api/types.ts` — must match the OpenAPI spec.

## Coding style

**TypeScript:** oxlint + oxfmt (2-space, double quotes). Strict mode, ESM. Shared configs: TS extends `@superserve/typescript-config`; Tailwind from `@superserve/tailwind-config`; single root `.oxlintrc.json` / `.oxfmtrc.json`.

**Python:** ruff (lint + format, line length 88), mypy. Python ≥ 3.9.

## Design language

The console has a deliberate austere, technical aesthetic:

- **Colors:** Charcoal canvas (`#141414` bg, `#1c1c1c` surfaces, `#eaeaea` fg). Brand accent is **mint** (`--color-brand` `#b2fab4`) for all interactive/live states. Status: mint = running, green = ready/healthy, amber = transitional, red = failed. Tokens in `packages/tailwind-config/theme.css`.
- **Borders:** Dashed everywhere (`border border-dashed border-border`). The signature visual trait — no solid decorative borders.
- **Translucency:** Floating surfaces (dialogs, menus, command palette, toasts, sticky headers) use translucent bg + `backdrop-blur`. Body surfaces stay solid.
- **Typography:** Instrument Sans (sans) + Geist Mono (mono). Buttons, badges, table headers: `font-mono uppercase text-xs`.
- **Corners:** Sharp throughout — no border-radius.
- **Corner brackets:** `<CornerBrackets />` frames active/selected items (sidebar nav, language tabs, empty states). Sizes: `sm`, `md`, `lg`.
- **Animations:** Scale-based (0.96x → 1x) for dialogs/popovers. Spring sticky hover via `motion` `layoutId` for nav, table rows, tabs. Defined in `packages/ui/src/styles/globals.css`.
- **Icons:** Phosphor Icons, `weight="light"`. `size-4` inline, `size-3.5` for buttons.
- **Layout:** Collapsible sidebar (16px collapsed / 64px expanded). Pages: `PageHeader` (h-14) → optional `TableToolbar` → scrollable content. Settings: `grid-cols-[240px_1fr]`.

## Branding

- Platform is `Superserve`; CLI tool is `superserve`
- Never "Claude" standalone — always "Claude Agent" or "Claude Agent SDK"

## PR reviews and merging

QM and other authorized independent automated reviewers may review and approve both ordinary and protected PRs after they review the current changes. Use an identity GitHub accepts for the required independent review; neither the author nor another agent using the author's credentials can approve their own PR. Required reviews, blocking findings, and CI still apply. A bot approval never counts as, or replaces, a human approval that GitHub or the `Protected Paths` check requires. Do not bypass these rules.

An ordinary PR changes no protected path. Once its required reviews and CI pass and it is up to date with `main`, the owning agent may merge it. First verify that the agent owns the PR; a shared login does not establish ownership. Read-only reviewers do not merge.

## Protected paths

`.github/CODEOWNERS` lists the paths that automation must not merge to `main` without a human. It is the only source of this list, but it is not the only human-review rule: the repository rulesets on `main` also require human reviews for other paths, and GitHub applies all of them. Today the list covers:

- CODEOWNERS, `CLAUDE.md`, and the executable CI and npm, PyPI and docs release workflows with their scripts. PR templates are not protected.
- Console request authentication, the sign-in and sign-up reCAPTCHA and Turnstile checks, security headers, env config, and the Supabase admin and regional service-role clients
- Every console server action and route handler, the `lib/api` server actions, and staff admin
- Team permissions, invitations, API keys, and secrets
- Billing, checkout, plans, signup offers, promotional credits, and device fingerprint evidence
- `LICENSE`

A protected PR needs an approval from a human code owner who is not its author; the `Protected Paths` check fails until it has one. It also needs a human merge decision. Agents may create, update, and review these PRs, but must not merge them, turn on auto-merge, or use a human's credentials to authorize their merge. A mixed PR is protected too, including when it deletes or moves a protected file.

- Merging `main` into the PR branch to keep it current is fine.
- Never bypass protections, use an administrator merge, or weaken CI.
- Adding, removing, or re-owning a protected path is itself a protected change.

## Git

- Single-line commit messages
- No "Co-Authored-By" or AI attribution in commits

## Public repo

- Code, comments, fixtures, commits, and PR titles/descriptions are all public
- Never name customers or their domains — use neutral placeholders (`pilot-team`, `example.com`)
- Never cite internal tracker IDs or internal URLs — describe the purpose in words instead
