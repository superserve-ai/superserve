# Fern-driven SDKs and Docs

**Date:** 2026-04-09
**Status:** Design
**Scope:** Monorepo migration to Fern for TypeScript SDK, Python SDK, and docs. Go SDK deferred. React hooks dropped.

## Goal

Make `api/openapi.yaml` the single source of truth for the Superserve API, and use Fern to generate:

1. `@superserve/sdk` — TypeScript client (npm)
2. `superserve` — Python client (PyPI)
3. Superserve docs site — replaces current Mintlify setup

All three live in and ship from the `superserve/` monorepo. Everything works with the existing Bun workspaces + Turborepo + uv workspaces toolchain.

## Non-goals

- Go SDK. Deferred — Go module paths inside a monorepo are awkward (`github.com/superserve-ai/superserve/packages/go-sdk`), and a clean answer likely involves a separate `superserve-go` repo. Revisit later.
- React hooks (`@superserve/sdk/react`). The current `useAgent` et al. target the retired agents API. Dropped entirely. A future `@superserve/sdk-react` on top of the new sandbox client is a separate project if we want it.
- Rewriting the CLI (`packages/cli/`). Out of scope. If CLI commands import the old SDK surface they will break when we wipe the handwritten source — the CLI rewrite is a follow-up.

## Context

- `packages/sdk` (TS) and `packages/python-sdk` (Python) are handwritten today and target the old agents/sessions API. The product pivoted to sandbox/VM infrastructure; the handwritten code is outdated and can be removed.
- A trial Fern setup exists at `/Users/nirnejak/Code/superserve/sdk/` with a working `openapi.yaml` (605 lines, ~8 endpoints across Sandboxes / Exec / Files / System) and a Fern config that generates TS + Python. It is reference-only. Package names and publish metadata there are placeholders. We rebuild in the monorepo.
- Docs today run on Mintlify (`docs/docs.json` + `docs/introduction.mdx`). We replace with Fern Docs on the free Hobby tier.
- Fern is Apache 2.0; the OSS CLI can generate locally via Docker at zero cost. Managed Fern (paid) handles hosted generation and auto-publishing. Initial plan: run the OSS CLI from the monorepo and publish from our own CI. Upgrading to managed Fern later is a config change, not a rewrite.

## Repo layout

```
superserve/
├── api/                                  NEW
│   ├── openapi.yaml                      single source of truth, ported from trial repo
│   └── fern/
│       ├── fern.config.json              { organization: "superserve", version: "<pinned>" }
│       ├── generators.yml                TS + Python generators, local-file-system output
│       └── docs.yml                      Fern Docs site config
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
    └── logo/                             re-referenced from api/fern/docs.yml
```

**Why `api/` at the repo root rather than `packages/api-spec/`:** the OpenAPI spec and Fern config are not a JS/Python/Go package. They are shared infrastructure that configures multiple packages. `api/` signals that plainly and keeps it out of the workspace glob.

**Why `.fernignore` per SDK package:** Fern's default behavior is to own the output directory and overwrite everything in it. `.fernignore` marks files/paths that Fern must leave alone across regenerations. We use it to hand-maintain `package.json` / `pyproject.toml` / build config / README per package, while Fern owns `src/`.

## Fern configuration

### `api/fern/fern.config.json`

```json
{
  "organization": "superserve",
  "version": "<pinned to latest stable at time of init>"
}
```

### `api/fern/generators.yml`

```yaml
api:
  specs:
    - openapi: ../openapi.yaml

default-group: local
groups:
  local:
    generators:
      - name: fernapi/fern-typescript-sdk
        version: <latest stable>
        output:
          location: local-file-system
          path: ../../packages/sdk/src
        config:
          namespaceExport: Superserve
          packageName: "@superserve/sdk"

      - name: fernapi/fern-python-sdk
        version: <latest stable>
        output:
          location: local-file-system
          path: ../../packages/python-sdk/src/superserve
        config:
          client_class_name: Superserve
          package_name: superserve
```

Notes:
- Generator versions are pinned explicitly. Upgrades are deliberate PRs, not drift.
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
      "inputs": ["api/openapi.yaml", "api/fern/**"],
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

`generate` is intentionally `cache: false` — Fern is fast, and caching regeneration adds a footgun when the spec changes.

### Root `package.json` scripts

```jsonc
{
  "scripts": {
    "generate": "cd api/fern && fern generate --group local",
    "generate:check": "cd api/fern && fern check"
  }
}
```

### Developer loop

```bash
# edit api/openapi.yaml
bun run generate              # Fern regenerates TS + Python sources
bun run build                 # tsup TS, uv build Python
# apps/console picks up the new SDK on next build/dev
```

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

### `.github/workflows/fern-generate.yml` (new)

- **Trigger:** push to `main` touching `api/openapi.yaml` or `api/fern/**`
- **Steps:** checkout → install Bun → install Fern CLI → `bun run generate` → if `git status` shows changes, open a PR titled `chore(sdk): regenerate from openapi.yaml`
- **Effect:** spec changes always produce visible regeneration PRs. No silent drift between spec and generated code.

### `.github/workflows/release.yml` (new)

- **Trigger:** `workflow_dispatch` with inputs: `package` (`ts` / `python` / `both`), `version`
- **Steps:** bump manifest → build → publish to npm and/or PyPI → commit bump → tag `@superserve/sdk@<v>` and/or `superserve-py@<v>`
- Manual, deliberate, one button per release.

### Spec linting on PRs

Existing lint workflow adds `bun run generate:check` as a step so PRs that change `api/openapi.yaml` get immediate feedback if the spec is malformed before Fern runs.

## Docs: Mintlify → Fern Docs

### Delete

- `docs/docs.json`
- `docs/introduction.mdx` (content ported)

### Add

- `api/fern/docs.yml` — Fern Docs config. Free Hobby tier, one site. Start on the `superserve.docs.buildwithfern.com` subdomain; flip to a custom domain (e.g. `docs.superserve.ai`) via DNS later.
- `docs/pages/introduction.mdx` — ported narrative content. Fern MDX is close enough to Mintlify MDX that this is mostly a copy with a few component renames.
- `docs/pages/` — future place for guides.

### `api/fern/docs.yml` shape

```yaml
instances:
  - url: superserve.docs.buildwithfern.com
    # custom-domain: docs.superserve.ai

title: Superserve

navigation:
  - section: Getting Started
    contents:
      - page: Introduction
        path: ../../docs/pages/introduction.mdx
  - api: API Reference
    snippets:
      typescript: "@superserve/sdk"
      python: superserve

colors:
  accent-primary:
    light: "#105C60"
    dark: "#119CA3"

logo:
  light: ../../docs/logo/light.svg
  dark: ../../docs/logo/dark.svg
```

The API Reference section is auto-generated from `api/openapi.yaml`; the generator wires TS/Python snippets from the two SDK packages so every endpoint page shows idiomatic client usage.

### Docs CI

A third workflow `.github/workflows/docs.yml`:
- **Trigger:** push to `main` touching `api/openapi.yaml`, `api/fern/docs.yml`, or `docs/pages/**`
- **Steps:** checkout → install Fern CLI → `cd api/fern && fern docs publish`

Preview on PRs via `fern docs generate --preview` in a PR comment bot is a nice-to-have, not blocking.

## Migration / teardown checklist

1. Create `api/openapi.yaml` from the trial repo, audit for correctness against the current backend.
2. Create `api/fern/` with `fern.config.json`, `generators.yml`, `docs.yml`.
3. Wipe handwritten code from `packages/sdk/src/` (including `src/react/`).
4. Wipe handwritten code from `packages/python-sdk/src/superserve/`.
5. Rewrite `packages/sdk/package.json` with publishable manifest.
6. Rewrite `packages/python-sdk/pyproject.toml` with PyPI metadata.
7. Add `.fernignore` files.
8. Run `bun run generate`. Commit generated sources.
9. Run `bun run build`. Verify artifacts.
10. Update `apps/console` and any other monorepo consumers to the new SDK surface. Expect import-site changes — the client class and method names differ from the old handwritten SDK.
11. Port `docs/introduction.mdx` to `docs/pages/introduction.mdx`, adjust component usage if needed.
12. Delete `docs/docs.json`.
13. Add the three GitHub Actions workflows.
14. First manual release: publish `@superserve/sdk@0.1.0` to npm, `superserve==0.1.0` to PyPI.
15. First docs publish: `fern docs publish`.
16. Follow-up (separate task): review `packages/cli/` for references to the old SDK surface and plan its rewrite.

## Open items

- **Fern org ownership.** Confirm we own `superserve` on `dashboard.buildwithfern.com`. The trial repo uses this name, but needs verification before we point production CI at it.
- **Fern tier.** Start on the free OSS CLI path. Upgrading to managed Fern (Basic $250/mo per SDK, or Pro $600/mo for SSE support) is deferred until there's a concrete reason — automated publishing via Fern, hosted spec validation, or SSE endpoints that need richer codegen than the OSS CLI produces.
- **Custom docs domain.** Defer until the content is ported and the site looks right on the Fern subdomain.
- **SSE / streaming endpoints.** The current `openapi.yaml` has a streaming exec endpoint. The OSS TS and Python generators handle SSE but ergonomics are generator-version-dependent. Verify the generated `stream()`-equivalent is acceptable during step 8; if not, we either upgrade generators or consider the managed Pro tier.
- **Versioning automation.** Manual bumps are fine for v0.x. Revisit Changesets or release-please at 1.0.
- **CLI fate.** `packages/cli/` may have commands tied to the old agents API. Audit as a follow-up, not part of this spec.
