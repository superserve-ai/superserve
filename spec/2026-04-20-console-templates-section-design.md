# Console Templates Section — Design

**Date:** 2026-04-20
**Scope:** Console only (SDK follows in a separate project)
**Decision:** Option B — minimal create flow (alias + base image + resources; no build-steps editor)

## Background

Templates are pre-baked VM images that sandboxes boot from. Each template has an `alias`, a VM shape (`vcpu / memory_mib / disk_mib`), and a `build_spec` (base OCI image + ordered build steps). Creating a template atomically queues a first build; subsequent builds are explicit via `POST /templates/{id}/builds`. Templates can be **team** (caller's team) or **system** (curated, visible to everyone). Build logs stream via Server-Sent Events.

The console currently has no Templates surface. API parameter references to `template_id` exist in `SandboxResponse` and `CreateSandboxRequest`, but there is no list, detail, or create flow.

## Goals

- Give users a first-class way to view and manage templates without leaving the console.
- Make the common case simple: save a curated base image + resource shape under an alias, use it to create sandboxes.
- Expose build status and live build logs clearly.
- Match the console's existing visual language (dashed borders, mono uppercase, corner brackets, sharp corners, scale-based motion).

## Non-goals (deferred)

- Build-steps editor (`run` / `copy` / `env` / `workdir` / `user`). Requires separate design — `copy` needs browser-side tar, and the API has no PATCH for `build_spec` which shapes the whole editor flow.
- Template editing / forking / duplication.
- Dockerfile import.
- Bulk multi-select actions.
- Metadata on templates.
- Team vs System template management UI (system templates are read-only from the console).

## Architecture

### Route map

```
/templates                        List (tabs: All / Team / System)
/templates/[template_id]          Detail (header, info grid, current build, build history)
```

No nested `/builds/*` routes; build history and logs render inline on the detail page.

### Sidebar

Add a new entry **Templates** between "Sandboxes" and "Audit Logs" in `apps/console/src/components/sidebar/nav-config.ts`. Icon: `StackIcon` from `@phosphor-icons/react` with `weight="light"`. Enabled (not behind a flag).

### API proxy

Add `"templates"` to `ALLOWED_PREFIXES` in `apps/console/src/app/api/[...path]/route.ts`. Verify the proxy can forward `text/event-stream` for the build-logs endpoint; if it buffers, extend it with a streaming passthrough for that specific path.

### Data layer

- **Types** (`apps/console/src/lib/api/types.ts`): add `BuildSpec`, `BuildStep`, `CreateTemplateRequest`, `CreateTemplateResponse`, `TemplateResponse`, `TemplateBuildResponse`, `BuildLogEvent`. Field names match the OpenAPI spec exactly (snake_case).
- **API client** (`apps/console/src/lib/api/templates.ts`): thin fetch wrappers for list / get / create / delete / listBuilds / createBuild / getBuild / cancelBuild. Uses the existing `client` helper.
- **Hooks** (`apps/console/src/hooks/use-templates.ts`): React Query hooks mirroring `use-sandboxes.ts` — `useTemplates`, `useTemplate`, `useTemplateBuilds`, `useCreateTemplate`, `useRebuildTemplate`, `useCancelTemplateBuild`, `useDeleteTemplate`.
- **Query keys** (`apps/console/src/lib/api/query-keys.ts`): `templateKeys` with `all`, `list(params)`, `detail(id)`, `builds(templateId)`, `build(templateId, buildId)`.
- **Refetch cadence:** list every 10 s (matches sandboxes). Detail every 5 s while status is `pending` / `building`; stop polling at `ready` / `failed`. Logs use SSE only, no polling.

### Components (new)

Under `apps/console/src/app/(dashboard)/templates/`:

- `page.tsx` — list page
- `[template_id]/page.tsx` — detail page
- `components/template-status-badge.tsx` — status pill (`building` / `ready` / `failed`) using existing `Badge` with `dot` prop
- `components/template-resources.tsx` — compact `1 vCPU · 1 GB · 4 GB`
- `components/template-table-row.tsx` — table row (mirrors `SandboxTableRow`)
- `components/create-template-dialog.tsx` — create form
- `components/delete-template-dialog.tsx` — confirm + 409 handling
- `components/build-log-viewer.tsx` — SSE log viewer
- `components/build-history-section.tsx` — list of builds with expand-to-view-logs
- `components/template-info-grid.tsx` — 4-col info grid
- `components/launch-from-template-button.tsx` — opens `CreateSandboxDialog` pre-filled with `from_template: alias`

## List page

### Layout

`PageHeader` (title "Templates", right-aligned `Create template` button) → `TableToolbar` (tabs + search) → `StickyHoverTableBody`.

### Tabs

All / Team / System. Tab counts derived from a single fetched list (no extra requests). System templates are identified by a single predicate `isSystemTemplate(t)` co-located with the types; first implementation compares `t.team_id` against the caller's `team_id` (the former is the system/curated owner). If the backend uses a different signal, the predicate is the only place that changes.

### Search

A single input in the toolbar that maps to the `alias_prefix` query param. Debounced (300 ms). No substring search — the API is prefix-only and pretending otherwise is worse UX.

### Columns

| Column | Value |
|--------|-------|
| Alias | Mono font. Primary identifier. |
| Status | Badge: `building` (orange, dot), `ready` (green, dot), `failed` (red, dot), `pending` (muted). |
| Resources | `1 vCPU · 1 GB · 4 GB` — mono, compact. |
| Size | `formatBytes(size_bytes)`, or `—` if not `ready`. |
| Built | Relative time (`built_at`, or `created_at` if never built). `—` if never built. |
| Actions | Kebab menu: Launch sandbox · Rebuild · Copy alias · Copy ID · Delete. |

System templates hide **Rebuild** and **Delete** (not owned by caller's team).

### Empty state

`EmptyState` component with a `StackIcon`, title "No templates yet", description mentioning templates produce sandboxes, primary action **Create template**, secondary hint "or use the CLI: `superserve templates build`".

### Error / loading states

Reuse existing `ErrorState` and `TableSkeleton`.

## Detail page

### Header

Breadcrumb (`Templates` → `<alias>`), alias (mono, large), copyable ID chip, status badge. Right-aligned action buttons:

- **Launch sandbox** (primary when `ready`)
- **Rebuild** (hidden for system templates; disabled while a build is in-flight)
- **Cancel build** (only shown while a build is in-flight)
- **Delete** (hidden for system templates)

### Info grid

4-col grid (dashed bordered cards):

1. **Resources** — `1 vCPU · 1 GB · 4 GB`
2. **Size** — `formatBytes(size_bytes)` or `—`
3. **Created** — relative + absolute tooltip
4. **Last built** — relative + absolute tooltip, or "Never"

### Current build panel

Shown when the most recent build is in `pending` / `building` / `snapshotting`. Contains:

- One-line status text with step count / phase if derivable from the `system` SSE stream.
- `BuildLogViewer` (see below) auto-connected to the current build.
- `Cancel build` button.

### Build history

Up to 20 recent builds (matches API default). Each row collapsed by default: status badge, started_at, finalized_at, error_message (first line). Click to expand → inline `BuildLogViewer` replaying that build's logs. Only one row expanded at a time. Failed builds expose a "Rebuild with same spec" shortcut on the row.

### Build spec preview

Read-only section (collapsed by default) showing the `build_spec` as a pretty-printed, syntax-highlighted block (`shiki` with `json`). Since Option B only writes `{ from: <image> }`, this will usually be short — but templates created via SDK/CLI may have full step lists, so we render whatever we get.

### Error states

- Template `failed` → info grid shows the failure reason inline; detail page CTA is **Rebuild** (not **Launch**).
- 404 on load → `ErrorState` with "Template not found" and a link back to `/templates`.

## Create template dialog

### Fields

| Field | Control | Default | Validation |
|-------|---------|---------|------------|
| Alias | Text | — | Required. Client: non-empty, max 128 chars, `^[a-z0-9][a-z0-9-]*$` preferred (server is permissive; we nudge toward URL-safe). |
| Base image | Dropdown + "Custom…" | `python:3.12` | Required. Curated: `python:3.11`, `python:3.12`, `node:20-slim`, `node:22-slim`, `ubuntu:24.04`, `debian:12-slim`. Custom: free text, reject `alpine` / `distroless` substrings client-side to match server. |
| vCPU | Segmented `1 / 2 / 4` | `1` | — (API allows 1–4; `3` intentionally omitted from UI in favour of a clean segmented control — users wanting `3` can use the CLI) |
| Memory | Select `256 / 512 / 1024 / 2048 / 4096 MiB` | `1024` | — |
| Disk | Select `1024 / 2048 / 4096 / 8192 MiB` | `4096` | — |

Memory and disk options match the OpenAPI ranges (`256–4096` and `1024–8192`).

### Submit behaviour

`POST /templates` with:

```json
{
  "alias": "<alias>",
  "vcpu": <vcpu>,
  "memory_mib": <memory>,
  "disk_mib": <disk>,
  "build_spec": { "from": "<image>" }
}
```

No `steps`, `start_cmd`, or `ready_cmd`. On success, navigate to `/templates/{id}` so the user lands directly in the live-log view for their first build. On failure, keep the dialog open and surface the error inline.

### Error mapping

- `400` with server message → inline under the offending field if identifiable (alias conflict on `alias`, image rejection on `base image`); otherwise a form-level banner.
- `409 alias_conflict` → inline under alias: "An alias with this name already exists in your team."
- `429 too_many_builds` → form-level banner: "Concurrent build limit reached. Wait for an in-flight build to finish."
- Other 5xx → generic form-level banner with retry CTA.

## Build log viewer

### Behaviour

- Opens an SSE connection to `/api/templates/{id}/builds/{buildId}/logs` via the Next.js proxy.
- Replays buffered output from the start of the build, then tails live until a `finished: true` event arrives. Closes the connection on terminal status.
- Events: `{ timestamp, stream: 'stdout' | 'stderr' | 'system', text, finished?, status? }`.
- Renders each line with stream-specific styling:
  - `stdout` → `text-foreground`, mono
  - `stderr` → `text-destructive`, mono
  - `system` → `text-muted-foreground`, mono, italic (supervisor status)
- Timestamps shown in a narrow left gutter (local time, `HH:mm:ss`), toggleable.
- Auto-scroll to bottom when the user is near the bottom. If the user scrolls up, auto-scroll pauses and a small "Jump to latest" pill appears bottom-right.
- On terminal event, render a final banner line with the overall status (`ready` / `failed` / `cancelled`) and total duration if derivable.

### Lifecycle

- Uses `EventSource` in the client. Reconnects once on unexpected disconnect; if reconnect fails, shows an error row and a manual "Reconnect" link.
- Unmounting closes the connection.
- On rebuild, the viewer re-connects to the new build's stream automatically.

## Actions

### Rebuild

`POST /templates/{id}/builds` with no body. Handles the idempotent `200` path (spec: same `build_spec_hash` returns the existing in-flight build) by showing a toast "A build is already in progress" and scrolling to the current build panel. Navigates to the detail page if invoked from the list.

### Cancel build

`DELETE /templates/{id}/builds/{build_id}` (only while status is `pending` / `building` / `snapshotting`). Confirm dialog before sending. Terminal builds hide the action.

### Delete template

`DELETE /templates/{id}`. Confirm dialog. On `409`, surface: "This template is still in use by N sandbox(es). Delete or stop using them, then try again." (Response body doesn't include counts; we show the generic message.)

### Launch sandbox from template

Opens the existing `CreateSandboxDialog` with `from_template: alias` pre-filled and the resources locked (template dictates VM shape per spec). After successful create, navigate to the new sandbox detail page.

## Status polling & staleness

- List query: `refetchInterval: 10_000`, matches sandboxes.
- Detail query: `refetchInterval: (data) => ['pending', 'building'].includes(data?.status) ? 5_000 : false`.
- Build history: refetches on detail interval (part of the same query tree).
- Logs: SSE only — no polling.
- After `useCreateTemplate` / `useRebuildTemplate` / `useCancelTemplateBuild` / `useDeleteTemplate`, invalidate relevant keys with React Query.

## Visual details

- Borders: dashed, `border border-dashed border-border`, on all surfaces (cards, dialog, inputs, log viewer container).
- Corners: sharp (no `rounded-*`).
- Typography: mono + uppercase for table headers, section headers, badges; sans for body.
- Icons: Phosphor, `weight="light"`, `size-4` inline / `size-3.5` in buttons.
- Corner brackets on empty state and on the detail page's build log viewer container.
- Animations: reuse existing `motion` sticky-hover pattern on table rows and tab switches; scale-based transitions on the create dialog (already defined in `globals.css`).

## Failure modes & edge cases

- **No team_id on system templates**: the response schema has `team_id` required but system templates may be distinguished another way. Before implementation, probe a staging response to confirm the shape and adjust the filter predicate.
- **SSE over proxy**: if the existing `[...path]/route.ts` can't stream (response is buffered because Next.js assumes JSON), add a narrow streaming passthrough that only kicks in for the logs path.
- **Long log output**: in-memory log buffer capped at 10k lines; older lines are trimmed with a "… truncated" indicator. Users who need full logs can re-open the build (replay).
- **Tab focus / reconnect**: if the browser tab is backgrounded and the SSE connection drops, the "Reconnect" link re-attaches (full replay, so no missed output).
- **Alias containing `/` or `:`**: server accepts any UTF-8 up to 128 chars; we route by `template_id` (UUID) not alias, so no URL-encoding hazards.
- **Template deleted while detail page is open**: next refetch returns 404; we show `ErrorState` and a link back to list.

## Verification before calling this done

- `bun run typecheck` clean
- `bunx biome check --write apps/console` clean
- Start the console dev server and walk through:
  1. Create a template with a curated base image → land on detail, see live logs, wait for `ready`.
  2. Launch a sandbox from it via the row action and via the detail header.
  3. Rebuild; cancel a rebuild mid-flight.
  4. Delete a template with no dependent sandboxes; delete one with a dependent sandbox and see the 409 message.
  5. Search by alias prefix; switch tabs; verify counts update.
  6. Open a failed build's logs; verify error mapping for `image_pull_failed` (use a bad image in the custom field).

## Explicit scope boundary

This design covers the console surface only. The SDK/CLI changes for templates are a separate project with their own design and plan. Nothing here assumes SDK changes; the console uses the Fern-generated client or direct fetches through the Next.js proxy as each resource's existing pattern dictates.
