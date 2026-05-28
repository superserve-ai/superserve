# Superserve Repo Simplification & Removal Audit

**Date:** 2026-05-28  
**Branch:** jeet/console-ui-design-update  
**Scope:** Full monorepo audit (root, apps/*, packages/*, tests/*, docs/, spec/, configs)  
**Goal:** Identify safe removals, hygiene problems, and simplification opportunities while preserving product velocity and the existing austere technical design language.

---

## Executive Summary

The repository is in **good structural health** overall:
- Zero build artifacts or `node_modules` are tracked in git.
- Centralized `oxlint` + `oxfmt` configs, Turborepo + Bun workspaces, and uv Python workspaces are modern and correct.
- Hand-crafted SDKs (zero runtime deps in TypeScript) are a genuine strength.
- Design system consistency (dashed borders, mint accent, sharp corners, Instrument Sans + Geist Mono) is followed.
- No leftover Radix UI code after the Base UI migration.

However, there is **significant surface-level and structural bloat** that increases clone time, install time, cognitive load for new contributors, and maintenance surface. The biggest offenders are generated artifacts on disk, a polluted root `package.json`, a 20+ file historical `spec/` directory, a missing-but-referenced `examples/` directory, and an external tooling artifact (`skills-lock.json`).

**High-impact immediate wins** (low risk, high cleanliness gain):
- Delete `apps/console/coverage/` (4.3 MB, hundreds of files)
- Delete `apps/ui-docs/dist/` (10 MB, 300+ files)
- Delete `.env.release` (secret on disk)
- Delete `skills-lock.json`
- Clean root `package.json` dependencies
- Tighten `.gitignore`
- Prune or archive most of `spec/`
- Fix the dangling `examples/` reference

**Medium-term simplifications** (require judgment):
- Re-evaluate the standalone `ui-docs` Vite app
- Consider whether all 10 `@xterm/*` packages are necessary
- Accept or mitigate TS/Python SDK duplication
- Trim or consolidate the 9 integration guide MDX pages

Estimated **removable on-disk bloat** (current checkout): **~15+ MB** of generated files + several small but noisy files.

---

## 1. High-Priority Removals (Do These First)

### 1.1 Generated Artifact Directories (Safe Deletes)

| Path | Size | Files | Reason | Action |
|------|------|-------|--------|--------|
| `apps/console/coverage/` | 4.3 MB | 100+ HTML/JS + lcov | Vitest `--coverage` output. Turbo declares it as an output but it is not gitignored for subdirectories. | Delete + add `**/coverage/` to `.gitignore` |
| `apps/ui-docs/dist/` | 10 MB | 300+ JS + 1 CSS | Vite production build. Should never be committed. | Delete + ensure `apps/ui-docs/dist/` ignored |
| `packages/cli/dist/`, `packages/sdk/dist/` | Small | Built artifacts | Currently empty or tiny on this checkout, but the pattern must be covered | Add explicit `**/dist/` patterns if not already sufficient |

**`.gitignore` currently only ignores top-level `dist/`, `.next/`, `node_modules/`, etc.** Subdirectory globs for apps/packages/tests are incomplete. This is the root cause of the visible bloat in directory listings.

### 1.2 Secrets and Tooling Artifacts on Disk

- **`.env.release`** (root) — Real secret file present on disk (even though gitignored). Violates the explicit CLAUDE.md rule: "Never commit secrets or env files." Delete it. Keep only `.env.release.example`.
- **`skills-lock.json`** (root, 12 KB) — External artifact from an AI coding agent "skills" marketplace system (references `pbakaus/impeccable`, `antfu/skills`, etc.). Not mentioned in any product code, docs, or CLAUDE.md. Delete + add to `.gitignore`.

### 1.3 Dead Reference: `examples/`

- Directory **does not exist** (`list_dir` returns error).
- CLAUDE.md and the monorepo structure diagram reference it under the root.
- **Fix:** Either create a minimal legitimate example (low value) **or** remove all references from CLAUDE.md, README, and any docs.

### 1.4 Historical Planning Documents (`spec/`)

- 20+ dated Markdown files from a concentrated April–May 2026 design sprint (`2026-04-02-*` through `2026-05-27-*`).
- Files include full design + plan pairs for features that have since shipped (design system migration, web terminal, table animations, auth redesign, templates, etc.).
- Two files appear ongoing: `console-improvements.md` and `server-side-proxy-auth.md`.
- **Recommendation:** Keep the two active ones. Archive or delete the rest (or move to a private design-history location). They add noise for anyone cloning the repo and reading the tree.

---

## 2. Hygiene Fixes (Must Fix)

### 2.1 Root `package.json` Pollution (Important)

Current root `package.json` declares many **app-specific** packages under top-level `"dependencies"`:

- `next`, `@supabase/ssr`, `@supabase/supabase-js`
- `posthog-js`, `posthog-node`
- `resend`, `@react-email/components`
- `tailwindcss`, `@tailwindcss/postcss`
- `vitest`, `happy-dom`, `@vitejs/plugin-react`
- `cmdk`

These are only used by `apps/console`, `apps/ui-docs`, or tests. Having them at root:
- Bloats the root `node_modules`
- Slows every `bun install`
- Creates risk of accidental cross-package imports of the wrong version

**Correct state:** Root should contain **only** shared dev tooling:
- `husky`, `lint-staged`, `mintlify`, `oxfmt`, `oxlint`, `turbo`

All other packages belong in the individual `apps/console/package.json`, `apps/ui-docs/package.json`, etc.

### 2.2 `.gitignore` Gaps

Add (at minimum):

```gitignore
# Coverage
**/coverage/
htmlcov/
.coverage

# Turborepo
**/.turbo/

# TypeScript incremental builds
**/*.tsbuildinfo

# Python
**/__pycache__/
**/*.py[cod]
**/.mypy_cache/
**/.pytest_cache/
**/.ruff_cache/

# Explicit subdirectory protection (belt + suspenders)
apps/**/node_modules/
packages/**/node_modules/
tests/**/node_modules/
apps/**/dist/
packages/**/dist/
apps/ui-docs/dist/
```

The current file already ignores top-level `node_modules/`, `dist/`, `.next/`, etc., and git status confirms nothing is tracked. The risk is future accidental `git add` of generated directories.

### 2.3 Other Small Hygiene Items

- `packages/python-sdk/package.json` exists but a pure Python package rarely needs one (uv/pyproject.toml is authoritative). It can usually be deleted unless it serves a specific purpose (e.g., some publishing script).
- Root has `assets/` (two SVGs) that are **not referenced** in the codebase (only README has an external GitHub image URL; email template uses an external URL). Consider moving or removing if unused.
- `.pre-commit-config.yaml` exists but the project primarily uses Husky + lint-staged. Verify both are still desired.

---

## 3. Simplification Opportunities (Judgment Required)

### 3.1 Heavy Terminal Dependency (`apps/console`)

The web terminal ([apps/console/src/components/sandboxes/terminal.tsx](/Users/nirnejak/Code/superserve/superserve/apps/console/src/components/sandboxes/terminal.tsx)) imports **10 separate `@xterm/*` packages**:

- `@xterm/xterm` + 8 addons (clipboard, fit, image, search, serialize, unicode11, web-links, webgl) + `@xterm/addon-ligatures`

This is a heavy dependency footprint for a feature used on sandbox detail pages. Some addons (image, serialize, unicode11, webgl) are niche. Evaluate whether a lighter approach or subset would suffice.

### 3.2 `apps/ui-docs` Standalone Vite App

- Separate Vite + React Router + shiki app (port 3003) whose sole job is to showcase `@superserve/ui` components.
- Contains 26 example files + registry + pages.
- Classic "docs drift" risk — the UI package can evolve faster than the docs app is updated.
- **Alternatives worth considering:**
  - Remove it and rely on Mintlify docs + code snippets
  - Move examples into the main console under a private `/__dev__/components` route (dev-only)
  - Adopt Storybook or a lighter docs generator

This is the single largest "is this worth the maintenance tax?" question in the repo.

### 3.3 TS SDK ↔ Python SDK Duplication

Both SDKs are **hand-crafted** (a deliberate and good decision for DX and zero-deps claims). However, this means:

- Every error class, retry/backoff logic, streaming SSE parser, file read/write helper, template build step, etc. is implemented twice.
- Types must be kept in sync manually (`packages/sdk/src/types.ts` vs Python `types.py` + console `lib/api/types.ts`).

**Long-term options:**
- Accept the cost (current state — justified for quality).
- Introduce a thin shared OpenAPI spec + minimal codegen for the "boring" mechanical parts while keeping hand-written high-level APIs.
- At minimum, keep a single source-of-truth document for the error hierarchy and wire types.

### 3.4 CLI Command Surface

- `packages/cli/src/commands/` contains 20 files.
- Several are thin index files that just compose CRUD subcommands (`agents/index.ts`, `sessions/index.ts`, `secrets/index.ts`).
- The surface (agents + sessions + secrets + deploy + run + init) is broad. Monitor PostHog telemetry to see which commands actually get usage. Low-usage commands can be deprecated or collapsed.

### 3.5 Documentation Surface

- 9 integration guide MDX files under `docs/integrations/` (Claude, Codex, OpenCode, Kilocode, Hermes, OpenClaw, agent harnesses, Mesa, etc.).
- These are primarily marketing/SEO/positioning content rather than core reference material.
- If analytics show low traffic, they can be consolidated into fewer "Integrations" overview pages.

### 3.6 Console Internal Micro-Abstractions

- Many small hooks (`use-create-param.ts`, `use-favicon-status.ts`, `use-selection.ts`) and tiny utility files.
- Query key factories are well-organized (`lib/api/query-keys.ts`).
- Some test files are larger than the implementation they test (common in auth flows).
- No egregious over-abstraction was found. The structure is reasonable for a dashboard of this complexity.

### 3.7 Test Volume

- Console has many colocated `.test.*` files (including for server actions and pages).
- SDKs and CLI have solid unit test coverage.
- E2E tests live in `tests/sdk-e2e-*` (correct location).
- No obvious dead tests, but the volume contributes to total file count.

---

## 4. Things That Are Already Good (Do Not Change)

- **Linting & formatting:** Single root `.oxlintrc.json` + `.oxfmtrc.json` with proper test overrides. Pre-commit + lint-staged + Husky pipeline is solid.
- **Monorepo tooling:** Bun workspaces + Turborepo + uv is the right modern stack. No per-package duplicate configs.
- **SDK design choices:** Zero runtime deps (TS), thoughtful error hierarchy, idempotent `kill()`, private access token rotation, retry with jitter — all excellent.
- **Design language enforcement:** The console follows the documented austere aesthetic (no border-radius, dashed borders, mint brand, sharp corners, `CornerBrackets`, sticky hover via `motion` `layoutId`).
- **Migration hygiene:** No `@radix-ui` imports remain in source (the Base UI migration is complete).
- **TypeScript strictness + ESM** across packages.
- **API proxy + server actions split** in console is clean and well-documented in CLAUDE.md.

---

## 5. Recommended Next Steps / PR Plan

1. **Immediate hygiene PR** (low risk, high signal)
   - Delete `coverage/`, `dist/` (ui-docs), `.env.release`, `skills-lock.json`
   - Update `.gitignore` with the patterns in section 2.2
   - Clean root `package.json` dependencies (move app-specific ones down)
   - Remove or fix `examples/` reference in CLAUDE.md
   - Add a root `.dockerignore` or similar if relevant (optional)

2. **Spec/ cleanup PR**
   - Archive or delete the 18+ completed sprint design docs
   - Keep only active files

3. **Investigation spikes** (no code change yet)
   - Measure real usage of the 10 xterm addons
   - Measure traffic + maintenance cost of `ui-docs`
   - Audit CLI command telemetry
   - Decide policy on integration guide pages

4. **Longer-term architecture conversations**
   - SDK code sharing strategy (or accept duplication)
   - Whether a single Next.js app can host both console and component docs

---

## 6. Appendix: Notable File Counts & Sizes (Current Checkout)

- Total tracked files: **498**
- Source files (rough, excluding build): **~1,367**
- On-disk bloat candidates:
  - `apps/console/coverage/`: 4.3 MB
  - `apps/ui-docs/dist/`: 10 MB
  - `skills-lock.json`: 12 KB
- Console has the largest individual files (auth pages + their tests, audit logs, settings).
- 31 UI components in `packages/ui/src/components/` — lean and focused.
- 9 integration MDX files + many SDK reference and sandbox docs pages.

---

**End of Audit**

This document should be treated as a living artifact. After the immediate removals and hygiene fixes land, re-run a lighter pass focused on the remaining simplification opportunities (xterm weight, ui-docs value, SDK duplication, CLI surface).