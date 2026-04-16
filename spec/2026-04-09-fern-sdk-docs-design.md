# Fern-driven SDKs and Docs

**Date:** 2026-04-09
**Status:** Design
**Scope:** Monorepo migration to Fern for TypeScript SDK, Python SDK, and docs. Go SDK deferred. React hooks dropped.

## Goal

The OpenAPI spec lives in the backend repo at `https://raw.githubusercontent.com/superserve-ai/sandbox/refs/heads/main/api/openapi.yaml`. This monorepo references that URL and uses Fern to generate:

1. `@superserve/sdk` — TypeScript client (npm)
2. `superserve` — Python client (PyPI)
3. Superserve docs site — replaces current Mintlify setup

All three live in and ship from the `superserve/` monorepo. Everything works with the existing Bun workspaces + Turborepo + uv workspaces toolchain. Zero changes required in the backend repo.

## Non-goals

- Go SDK. Deferred — Go module paths inside a monorepo are awkward (`github.com/superserve-ai/superserve/packages/go-sdk`), and a clean answer likely involves a separate `superserve-go` repo. Revisit later.
- React hooks (`@superserve/sdk/react`). The current `useAgent` et al. target the retired agents API. Dropped entirely. A future `@superserve/sdk-react` on top of the new sandbox client is a separate project if we want it.
- Rewriting the CLI (`packages/cli/`). Out of scope. If CLI commands import the old SDK surface they will break when we wipe the handwritten source — the CLI rewrite is a follow-up.

## Context

- `packages/sdk` (TS) and `packages/python-sdk` (Python) are handwritten today and target the old agents/sessions API. The product pivoted to sandbox/VM infrastructure; the handwritten code is outdated and can be removed.
- The backend repo at `github.com/superserve-ai/sandbox` owns `api/openapi.yaml` (~605 lines, ~8 endpoints across Sandboxes / Exec / Files / System). It is the single source of truth. This monorepo references it by URL — no local copy, no mirroring.
- A trial Fern setup exists at `/Users/nirnejak/Code/superserve/sdk/` that generates TS + Python from a local copy of the spec. It is reference-only. Package names and publish metadata there are placeholders. We rebuild in the monorepo using the remote URL.
- Docs today run on Mintlify (`docs/docs.json` + `docs/introduction.mdx`). We replace with Fern Docs on the free Hobby tier.
- Fern is Apache 2.0; the OSS CLI can generate locally via Docker at zero cost. Fern's OpenAPI spec field accepts HTTP(S) URLs and fetches on each generate run. Managed Fern (paid) is not needed for this plan — upgrade later is a config change, not a rewrite.

## Repo layout

```
superserve/
├── fern/                                 NEW — Fern's own convention (fern init layout)
│   ├── fern.config.json                  { organization: "superserve", version: "<pinned>" }
│   ├── generators.yml                    TS + Python generators; spec is a remote URL
│   └── docs.yml                          Fern Docs site config
│
├── packages/
│   ├── sdk/                              EXISTING — handwritten code wiped
│   │   ├── .fernignore                   preserves package.json, tsup.config.ts, README.md, dist/
│   │   ├── package.json                  @superserve/sdk, hand-maintained, publishable
│   │   ├── tsup.config.ts                ESM+CJS build
│   │   ├── README.md
│   │   └── src/                          Fern-owned, regenerated
│   │
│   └── python-sdk/                       EXISTING — handwritten code wiped
│       ├── .fernignore                   preserves pyproject.toml, README.md
│       ├── pyproject.toml                superserve, hand-maintained, PyPI metadata
│       ├── README.md
│       └── src/superserve/               Fern-owned, regenerated
│
└── docs/                                 EXISTING — Mintlify files removed
    ├── pages/                            MDX content (ported from existing docs)
    │   └── introduction.mdx
    └── logo/                             re-referenced from fern/docs.yml
```

**Why `fern/` at the repo root:** it is Fern's default convention, what `fern init` creates, and what every Fern example uses. Short path, zero ambiguity about what it is. No local OpenAPI spec lives here — Fern fetches it from the backend repo URL on each generate run.

**Why `.fernignore` per SDK package:** Fern's default behavior is to own the output directory and overwrite everything in it. `.fernignore` marks files/paths that Fern must leave alone across regenerations. We use it to hand-maintain `package.json` / `pyproject.toml` / build config / README per package, while Fern owns `src/`.

## Fern configuration

### `fern/fern.config.json`

```json
{
  "organization": "superserve",
  "version": "<pinned to latest stable at time of init>"
}
```

### `fern/generators.yml`

```yaml
api:
  specs:
    - openapi: https://raw.githubusercontent.com/superserve-ai/sandbox/refs/heads/main/api/openapi.yaml

default-group: local
groups:
  local:
    generators:
      - name: fernapi/fern-typescript-sdk
        version: <latest stable>
        output:
          location: local-file-system
          path: ../packages/sdk/src
        config:
          namespaceExport: Superserve
          packageName: "@superserve/sdk"

      - name: fernapi/fern-python-sdk
        version: <latest stable>
        output:
          location: local-file-system
          path: ../packages/python-sdk/src/superserve
        config:
          client_class_name: Superserve
          package_name: superserve
```

Notes:
- The spec is referenced via a remote URL pinned to the backend repo's `main` branch. Fern fetches it on every `fern generate` run. No local copy.
- Pinning to `main` means any backend merge that changes the spec is picked up the next time we regenerate. Tight coupling is intentional during active development. Post-1.0 we can pin to a tag or commit SHA for deliberate upgrades.
- Generator versions themselves are pinned explicitly. Generator upgrades are deliberate PRs, not drift.
- Both generators write into the existing workspace packages. Package metadata (`package.json`, `pyproject.toml`) is hand-owned via `.fernignore`.
- `packageName` / `package_name` config fields are still set so that generated code references the correct import path in examples and snippets, even though we own the manifest files.

### `.fernignore` contents

**`packages/sdk/.fernignore`:**
```
package.json
tsup.config.ts
tsconfig.json
README.md
dist
.turbo
node_modules
```

**`packages/python-sdk/.fernignore`:**
```
pyproject.toml
README.md
.turbo
```

## Package manifests (hand-maintained)

### `packages/sdk/package.json`

- `name: "@superserve/sdk"`, `version: "0.1.0"`, **not private**
- `type: module`
- `main`, `module`, `types`, `exports` pointing at `dist/` (ESM + CJS)
- `files: ["dist"]`
- `repository`, `license: "Apache-2.0"`, `homepage`, `bugs`
- `scripts`: `build` (tsup), `dev`, `typecheck`, `lint`, `clean`
- Dependencies: whatever Fern's TS generator uses. No `react`, no `@superserve/sdk/react` entrypoint.

Apps in the monorepo (`apps/console`, etc.) reference it as `"@superserve/sdk": "workspace:*"`. Bun resolves to the built `dist/` output. The published npm artifact is the same `dist/`.

### `packages/python-sdk/pyproject.toml`

- `name = "superserve"`, `version = "0.1.0"`, `requires-python = ">=3.9"`
- `build-system = "hatchling"` (or whatever matches the rest of the repo's Python packages)
- Proper PyPI metadata: description, authors, license, classifiers, URLs, README
- `dependencies`: whatever Fern's Python generator emits (typically `httpx`, `pydantic`, `typing-extensions`)
- `[tool.hatch.build.targets.wheel] packages = ["src/superserve"]`

Python package stays part of the existing uv workspace at the repo root — no changes to the workspace `pyproject.toml`.

## Turborepo integration

### New tasks in root `turbo.json`

```jsonc
{
  "tasks": {
    "generate": {
      "inputs": ["fern/**"],
      "outputs": [
        "packages/sdk/src/**",
        "packages/python-sdk/src/superserve/**"
      ],
      "cache": false
    },
    "release": {
      "dependsOn": ["build"],
      "cache": false
    }
  }
}
```

`generate` is intentionally `cache: false` — the remote spec can change without any local file changing, so caching on inputs would be wrong. Fern is fast enough that caching adds no value.

### Root `package.json` scripts

```jsonc
{
  "scripts": {
    "generate": "cd fern && fern generate --group local",
    "generate:check": "cd fern && fern check"
  }
}
```

### Developer loop

```bash
# backend team merges a spec change in github.com/superserve-ai/sandbox
bun run generate              # Fern fetches latest openapi.yaml from URL and regenerates
bun run build                 # tsup TS, uv build Python
# apps/console picks up the new SDK on next build/dev
```

Because there is no local spec file, regeneration is a **pull-on-demand** operation. No file-watcher, no automatic trigger — you run it when you know (or suspect) the backend spec has changed.

## Publishing

### TypeScript — `@superserve/sdk`

- `bun run build --filter=@superserve/sdk` produces `packages/sdk/dist/`
- `cd packages/sdk && bun publish --access public`
- Versioning: manual `package.json` bump during v0.x. Revisit Changesets once we hit 1.0.

### Python — `superserve`

- `uv build packages/python-sdk` produces `packages/python-sdk/dist/*.whl` and `*.tar.gz`
- `uv publish --project packages/python-sdk` with `UV_PUBLISH_TOKEN` from env
- Versioning: manual `pyproject.toml` bump during v0.x.

### Convenience wrapper (optional, not blocking)

A root `bun run release` script that runs generate → build → publish for both. Added only if needed; manual two-step release is fine for now.

## CI / CD

Kept deliberately minimal. No backend changes, no cross-repo dispatch, no scheduled jobs. Everything is manual and explicit.

### `.github/workflows/fern-generate.yml` (new)

- **Trigger:** `workflow_dispatch` only (manual button in GitHub Actions UI)
- **Steps:** checkout → install Bun → install Fern CLI → `bun run generate` → if `git status` shows changes, open a PR titled `chore(sdk): regenerate from openapi.yaml`
- **When to run it:** when the backend team merges a spec change and you want the SDKs updated. Documented in README.

### `.github/workflows/release.yml` (new)

- **Trigger:** `workflow_dispatch` with inputs: `package` (`ts` / `python` / `both`), `version`
- **Steps:** bump manifest → build → publish to npm and/or PyPI → commit bump → tag `@superserve/sdk@<v>` and/or `superserve-py@<v>`
- Manual, deliberate, one button per release. Documented in README.

### Spec linting

Optional: `bun run generate:check` as a pre-release sanity check. Not wired to PR CI since PRs in this repo don't touch the spec.

## Docs: Mintlify → Fern Docs

### Delete

- `docs/docs.json`
- `docs/introduction.mdx` (content ported)

### Add

- `fern/docs.yml` — Fern Docs config. Free Hobby tier, one site. Start on the `superserve.docs.buildwithfern.com` subdomain; flip to a custom domain (e.g. `docs.superserve.ai`) via DNS later.
- `docs/pages/introduction.mdx` — ported narrative content. Fern MDX is close enough to Mintlify MDX that this is mostly a copy with a few component renames.
- `docs/pages/` — future place for guides.

### `fern/docs.yml` shape

```yaml
instances:
  - url: superserve.docs.buildwithfern.com
    # custom-domain: docs.superserve.ai

title: Superserve

navigation:
  - section: Getting Started
    contents:
      - page: Introduction
        path: ../docs/pages/introduction.mdx
  - api: API Reference
    snippets:
      typescript: "@superserve/sdk"
      python: superserve

colors:
  accent-primary:
    light: "#105C60"
    dark: "#119CA3"

logo:
  light: ../docs/logo/light.svg
  dark: ../docs/logo/dark.svg
```

The API Reference section is auto-generated from the remote OpenAPI spec (same URL as `generators.yml`). TS/Python snippets come from the two SDK packages so every endpoint page shows idiomatic client usage.

### Docs publishing

A third workflow `.github/workflows/docs.yml`:
- **Trigger:** `workflow_dispatch` only — manual button
- **Steps:** checkout → install Fern CLI → `cd fern && fern docs publish`
- **When to run it:** after spec changes, after editing MDX content, or on any docs update. Documented in README.

## Migration / teardown checklist

1. Create `fern/` at repo root with `fern.config.json`, `generators.yml` (referencing the backend spec URL), `docs.yml`.
2. Wipe handwritten code from `packages/sdk/src/` (including `src/react/`).
3. Wipe handwritten code from `packages/python-sdk/src/superserve/`.
4. Rewrite `packages/sdk/package.json` with publishable manifest.
5. Rewrite `packages/python-sdk/pyproject.toml` with PyPI metadata.
6. Add `.fernignore` files to both SDK packages.
7. Run `bun run generate`. Commit generated sources.
8. Run `bun run build`. Verify artifacts.
9. Update `apps/console` and any other monorepo consumers to the new SDK surface. Expect import-site changes — the client class and method names differ from the old handwritten SDK.
10. Port `docs/introduction.mdx` to `docs/pages/introduction.mdx`, adjust component usage if needed.
11. Delete `docs/docs.json`.
12. Add the three GitHub Actions workflows (all `workflow_dispatch`).
13. Add a **SDK & Docs** section to the root `README.md` documenting: how to regenerate SDKs, how to publish npm/PyPI, how to publish docs, and when to run each step.
14. First manual release: publish `@superserve/sdk@0.1.0` to npm, `superserve==0.1.0` to PyPI.
15. First docs publish: `fern docs publish`.
16. Follow-up (separate task): review `packages/cli/` for references to the old SDK surface and plan its rewrite.

## README documentation

The root `README.md` gets a new section with three subsections covering every manual operation. Sample shape:

```markdown
## SDKs & Docs

The Superserve SDKs (`@superserve/sdk`, `superserve`) and docs site are generated
by Fern from the OpenAPI spec in the backend repo
(`github.com/superserve-ai/sandbox/api/openapi.yaml`). This monorepo references
that URL directly — no local copy.

### Regenerating the SDKs

Run this when the backend team has merged a spec change:

\`\`\`bash
bun run generate       # fetches latest spec from main, regenerates TS + Python
bun run build          # tsup TS, uv build Python
\`\`\`

Commit the diff. If you prefer CI, trigger the `fern-generate` workflow manually
in GitHub Actions.

### Publishing to npm and PyPI

\`\`\`bash
# TypeScript
cd packages/sdk
# bump version in package.json
bun run build
bun publish --access public

# Python
cd packages/python-sdk
# bump version in pyproject.toml
uv build
uv publish             # requires UV_PUBLISH_TOKEN
\`\`\`

Or trigger the `release` workflow manually in GitHub Actions with `package` and
`version` inputs.

### Publishing the docs

\`\`\`bash
cd fern
fern docs publish
\`\`\`

Or trigger the `docs` workflow manually in GitHub Actions.
```

## Open items

- **Fern org ownership.** Confirm we own `superserve` on `dashboard.buildwithfern.com`. The trial repo uses this name, but needs verification before we point production CI at it.
- **Fern tier.** Stay on the free OSS CLI path. Managed Fern (Basic $250/mo per SDK, or Pro $600/mo for SSE support) is deferred until there is a concrete reason.
- **Custom docs domain.** Defer until the content is ported and the site looks right on the Fern subdomain.
- **SSE / streaming endpoints.** The remote `openapi.yaml` has a streaming exec endpoint. OSS TS and Python generators handle SSE but ergonomics are generator-version-dependent. Verify the generated `stream()`-equivalent during step 8; if unacceptable, either upgrade generators or consider managed Pro.
- **Spec URL pinning.** Pinned to `main` during development — any backend merge can change the SDK surface on next `generate`. Tighten to a tag or commit SHA post-1.0.
- **Versioning automation.** Manual bumps are fine for v0.x. Revisit Changesets or release-please at 1.0.
- **CLI fate.** `packages/cli/` may have commands tied to the old agents API. Audit as a follow-up, not part of this spec.
