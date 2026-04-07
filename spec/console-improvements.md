# Console Improvements Spec

Comprehensive review based on deep codebase analysis and competitor research (E2B, Modal, Fly.io, Vercel, Railway, Supabase).

## Context

- Target users: Technical developers integrating via SDK, desktop-first
- Scale: ~dozen sandboxes per user initially
- No Go backend changes in this release
- Multi-team/org coming later

---

## P0 — Fix Now (Bugs, Security, Correctness)

### 1. Commit package.json + bun.lock for shiki

`shiki` was added to `@superserve/ui` locally but never committed. Vercel builds fail because the dependency doesn't exist in the lockfile. **This is blocking all deployments.**

### 2. Dev auth env var exposure

`NEXT_PUBLIC_ENABLE_DEV_AUTH` is a client-exposed env var. Anyone can inspect the JS bundle to see if dev auth is enabled and find the hardcoded dev credentials in the source. Move to a server-only env var and check it in a server action or API route, not in client-side code.

- `src/lib/auth-helpers.ts`
- `src/app/(auth)/auth/signin/page.tsx`

### 3. Middleware cookie domain mismatch

In `packages/supabase/src/middleware.ts`, request cookies are set without `domainOpts`, but response cookies include them. This causes cookie domain mismatches in multi-subdomain setups.

```typescript
// Bug (line ~34): missing domainOpts
request.cookies.set(name, value)
// Correct (line ~39): has domainOpts
response.cookies.set(name, value, { ...options, ...domainOpts })
```

### 4. Open redirect hardening

`src/app/(auth)/auth/signin/page.tsx` — `rawNext.startsWith("/")` passes `//evil.com`. Add explicit check: reject if `next` starts with `//`.

---

## P1 — This Sprint (High Impact, Moderate Effort)

### 5. Extract duplicate constants

`STATUS_BADGE_VARIANT` and `STATUS_LABEL` are copy-pasted in 3 files. `formatBytes`, `formatDuration`, `ACTIVITY_STATUS_VARIANT` also duplicated.

Create `src/lib/sandbox-utils.ts`:
```typescript
export const STATUS_BADGE_VARIANT: Record<SandboxStatus, BadgeVariant> = { ... }
export const STATUS_LABEL: Record<SandboxStatus, string> = { ... }
```

Files to update: `sandboxes/page.tsx`, `[sandbox_id]/page.tsx`, `[sandbox_id]/terminal/page.tsx`

### 6. Add error boundaries

No React error boundaries exist anywhere. A single component error crashes the entire page.

- Wrap `DashboardShell` children in an error boundary
- Add per-page error boundaries for data-dependent sections
- Use Next.js `error.tsx` convention in route groups

### 7. Sync filters to URL search params (deep linking)

`statusFilter` and `search` on `/sandboxes` and `/api-keys` are `useState` only. Links aren't shareable, browser back/forward breaks filtering.

Use `useSearchParams` from Next.js:
```typescript
const searchParams = useSearchParams()
const statusFilter = searchParams.get("status") ?? "all"
```

Every competitor (Vercel, Railway, Supabase) does this.

### 8. Add request timeout to API client

`src/lib/api/client.ts` — `fetch()` has no timeout. A hanging request blocks indefinitely.

Add `AbortController` with 30s timeout:
```typescript
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 30_000)
```

### 9. Cap terminal output buffer

`src/hooks/use-exec-stream.ts` — `output: OutputLine[]` grows unbounded. A long-running command producing thousands of lines will cause memory bloat and scroll performance issues.

Add a max line limit (e.g., 5000 lines), trim from the top when exceeded.

### 10. Add missing loading skeletons

Pages without loading states: `/settings`, `/plan-usage`. Add `TableSkeleton` or page-specific skeletons to match the pattern used in sandboxes/api-keys pages.

### 11. Command palette (Cmd+K)

Used by Vercel, Supabase, Daytona. The single highest-impact power-user feature.

Use `cmdk` library. Actions: search sandboxes by name/ID, navigate to any page, create sandbox, create API key, open docs.

The sidebar already has a search UI element with the `K` kbd shortcut shown — wire it up.

---

## P2 — This Month (Quality & UX Polish)

### 12. Refactor oversized page components

- `sandboxes/page.tsx` (~370 lines) — extract `SandboxesTable`, move dialog state management
- `[sandbox_id]/page.tsx` (~460 lines) — extract `ActivitySection`, `SnapshotsSection`
- `api-keys/page.tsx` — extract `CreateKeyDialog` to its own file

### 13. Standardize form input API in UI package

Inconsistent across components:
- `Input`: `error` is boolean
- `Textarea`: `error` is string, has `label` and `description`
- `Field`: `error` is string, has `label` and `description`

Standardize: all form inputs accept `error?: string`, `description?: string`. Use `Field` as the wrapper pattern consistently.

### 14. Add forwardRef to UI components

Missing from: `Button`, `Textarea`, `Card` (all sub-components), `Badge`, `Alert`, `Separator`, `Table` (all sub-components). Only `Input` has it.

This limits consumers from doing focus management, imperative operations, and composition.

### 15. Resolution-oriented error messages

Current `ErrorState` and toast errors just show `error.message`. Follow Vercel's pattern — guide the user to fix the problem:

- "Failed to create sandbox" → "Failed to create sandbox. Check that you haven't exceeded your plan limits."
- "Not authenticated" → "Your session has expired. Sign in again to continue."

### 16. Tabular nums on numeric columns

Add `font-variant-numeric: tabular-nums` to resource columns (`1CPU | 1024MB`), date columns, and any other numeric data. Numbers currently misalign in tables.

### 17. Real-time sandbox status

Current: polling every 2s only for `pausing` status. Sandbox list doesn't auto-refresh at all.

Add a 10s `refetchInterval` on `useSandboxes()` when the page is visible, or use `refetchOnWindowFocus: true` (React Query supports this). This avoids the need for WebSocket/SSE without backend changes.

### 18. Favicon status indicator

Reflect sandbox activity in the browser tab favicon. Simple: swap between default and a "working" favicon when any sandbox is in a transitional state.

### 19. First-encounter empty state for sandboxes

The current `EmptyState` is generic. For brand-new users seeing the sandboxes page for the first time, show a richer onboarding: a 3-step inline guide (install SDK → get API key → create sandbox) that borrows from the get-started page content.

### 20. Keyboard shortcuts

Beyond Cmd+K: `c` to create sandbox (when not in an input), `/` to focus search, `Esc` to close dialogs. Show a `?` shortcut overlay. Vercel does this extensively.

---

## P3 — Next Quarter (Scalability & Completeness)

### 21. Pagination / virtual scrolling

Audit logs, snapshots, and sandbox lists load everything into memory. Fine for a dozen sandboxes, but won't scale. Add cursor-based pagination to API calls and table UI.

### 22. Logs viewer tab on sandbox detail

Add a "Logs" tab to `/sandboxes/[id]` showing stdout/stderr with live tailing and time-range filtering. Modal and Fly.io both treat logs as first-class.

### 23. Sandbox detail page enrichment

Current detail page shows: resources, IP, snapshot, created date, activity table, snapshots table.

Add: lifecycle timeline (created → active → paused → resumed), environment variables (names + digests, never values), resource usage indicators.

### 24. Consolidate animation system in UI package

3 components use `motion/react`, the rest use CSS transitions in `globals.css`. Timing is inconsistent (100ms/120ms/150ms/200ms). Pick one approach and standardize.

### 25. Dark/light mode support in UI package

Currently hardcoded dark theme. The `tailwind-config/theme.css` defines `@custom-variant dark` but it's never used. Add CSS variable-based theming so the UI package works in both modes. Not urgent since the console is dark-only, but blocks UI package reuse.

### 26. Add missing UI components

Design system gaps: Spinner/Loader (only Skeleton exists), Pagination, Combobox/Autocomplete, Tag Input. Add as needed rather than speculatively.

### 27. Test coverage

Currently only auth pages have tests. Highest ROI additions:
- Hook tests: `use-sandboxes`, `use-api-keys`, `use-exec-stream`
- API module tests: `client.ts`, `proxy-auth.ts`
- Integration tests for the proxy route

### 28. Environment variable validation

No validation that required env vars exist at startup. Create `src/lib/env.ts` that validates and types all env vars, failing fast with clear errors.

### 29. Usage/cost dashboard

Show sandbox hours consumed, API calls, and costs. E2B and Railway both surface this prominently. The existing `/plan-usage` page is a skeleton — flesh it out.

### 30. Snapshot browser in create dialog

In the create sandbox dialog, show available snapshots with descriptions rather than just a dropdown with "superserve/base". Similar to E2B's template gallery.

---

## UI Package Specific

| Issue | Priority | Notes |
|-------|----------|-------|
| Missing `forwardRef` on 8 components | P2 | Button, Textarea, Card, Badge, Alert, Separator, Table |
| Missing `displayName` on 26 components | P3 | Only Input has it |
| ARIA gaps in Dialog, Menu, Select, Tooltip | P2 | Keyboard nav, roles, expanded states |
| Inconsistent form input API | P2 | Standardize error/description/label |
| Animation system fragmented | P3 | motion/react vs CSS transitions |
| Missing type exports in index.ts | P3 | ~8 component prop types not exported |
| No Spinner component | P2 | Only Skeleton exists, need inline spinner |
| No Pagination component | P3 | Needed when lists scale |

---

## Competitor Patterns Worth Stealing

| Pattern | Used By | Effort | Impact |
|---------|---------|--------|--------|
| Command palette (Cmd+K) | Vercel, Supabase | Medium | Very High |
| Deep-linked filters | Everyone | Low | High |
| Resolution-oriented errors | Vercel | Low | Medium |
| Favicon status | Vercel | Low | Medium |
| First-encounter empty states | Supabase | Low | Medium |
| Execution timeline on detail page | Modal | High | High |
| Live log tailing | Fly.io, Modal | High | High |
| Usage/cost dashboard | E2B, Railway | Medium | Medium |
| Keyboard shortcuts | Vercel | Medium | Medium |
| Tabbed terminal | Supabase (SQL editor) | High | Medium |
