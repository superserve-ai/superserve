# Console Templates Section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Templates section in the console: sidebar link, list page (tabs + search + table), detail page with live build logs, minimal create dialog, and rebuild / cancel / delete actions. Option B scope — no build-steps editor.

**Architecture:** New `/templates` and `/templates/[template_id]` routes under the dashboard layout. React Query hooks call the Next.js `/api/templates/*` proxy, which forwards to the platform API with an injected server-side key. The build-logs endpoint streams `text/event-stream`, handled by a small extension to the existing proxy and consumed in the client via `EventSource`. New shared UI components live under `apps/console/src/components/templates/`. Types match the OpenAPI spec exactly.

**Tech Stack:** Next.js 16 (App Router) · React Query · TypeScript strict · Tailwind CSS · `@base-ui/react` (via `@superserve/ui`) · `motion` · Phosphor Icons · Shiki · Biome · Vitest.

**Important:** Per user preference, **do not create git commits** at any step. Each task ends with a verification checkpoint only. If the executor is instructed otherwise later, commits can be added per task boundary.

---

## File Structure

### Created files

| File | Responsibility |
|------|---------------|
| `apps/console/src/lib/api/templates.ts` | Thin fetch wrappers for `/templates*` endpoints. |
| `apps/console/src/hooks/use-templates.ts` | React Query hooks for templates + builds. |
| `apps/console/src/lib/templates/is-system-template.ts` | Single predicate identifying system vs team templates. |
| `apps/console/src/lib/templates/format-build-error.ts` | Maps build-error codes to human strings. |
| `apps/console/src/lib/templates/format-build-error.test.ts` | Unit tests. |
| `apps/console/src/lib/templates/is-system-template.test.ts` | Unit tests. |
| `apps/console/src/app/(dashboard)/templates/page.tsx` | List page. |
| `apps/console/src/app/(dashboard)/templates/loading.tsx` | List loading state. |
| `apps/console/src/app/(dashboard)/templates/[template_id]/page.tsx` | Detail page. |
| `apps/console/src/app/(dashboard)/templates/[template_id]/loading.tsx` | Detail loading state. |
| `apps/console/src/components/templates/template-status-badge.tsx` | Status pill. |
| `apps/console/src/components/templates/template-resources.tsx` | `1 vCPU · 1 GB · 4 GB` display. |
| `apps/console/src/components/templates/template-table-row.tsx` | List row. |
| `apps/console/src/components/templates/template-row-actions.tsx` | Kebab menu (launch / rebuild / copy / delete). |
| `apps/console/src/components/templates/create-template-dialog.tsx` | Create form. |
| `apps/console/src/components/templates/delete-template-dialog.tsx` | Delete confirm + 409 handling. |
| `apps/console/src/components/templates/template-info-grid.tsx` | 4-col info grid on detail. |
| `apps/console/src/components/templates/current-build-panel.tsx` | Active-build surface w/ live logs. |
| `apps/console/src/components/templates/build-history-section.tsx` | Historical builds list. |
| `apps/console/src/components/templates/build-log-viewer.tsx` | SSE log viewer. |
| `apps/console/src/components/templates/build-spec-preview.tsx` | Read-only `build_spec` JSON block. |

### Modified files

| File | Change |
|------|--------|
| `apps/console/src/app/api/[...path]/route.ts` | Add `"templates"` to `ALLOWED_PREFIXES`; add streaming passthrough for `text/event-stream` responses. |
| `apps/console/src/lib/api/types.ts` | Append template types matching OpenAPI. |
| `apps/console/src/lib/api/query-keys.ts` | Append `templateKeys`. |
| `apps/console/src/components/sidebar/nav-config.ts` | Add Templates nav entry. |

---

## Task 1: Extend types with template schemas

**Files:**
- Modify: `apps/console/src/lib/api/types.ts`

- [ ] **Step 1: Append template types**

Append to the bottom of `apps/console/src/lib/api/types.ts`:

```ts
export type TemplateStatus = "pending" | "building" | "ready" | "failed"

export type BuildStatus =
  | "pending"
  | "building"
  | "snapshotting"
  | "ready"
  | "failed"
  | "cancelled"

export interface BuildStepRun {
  run: string
}
export interface BuildStepCopy {
  copy: { src: string; dst: string }
}
export interface BuildStepEnv {
  env: { key: string; value: string }
}
export interface BuildStepWorkdir {
  workdir: string
}
export interface BuildStepUser {
  user: { name: string; sudo?: boolean }
}
export type BuildStep =
  | BuildStepRun
  | BuildStepCopy
  | BuildStepEnv
  | BuildStepWorkdir
  | BuildStepUser

export interface BuildSpec {
  from: string
  steps?: BuildStep[]
  start_cmd?: string
  ready_cmd?: string
}

export interface CreateTemplateRequest {
  alias: string
  vcpu?: number
  memory_mib?: number
  disk_mib?: number
  build_spec: BuildSpec
}

export interface CreateTemplateResponse {
  id: string
  team_id: string
  alias: string
  status: Exclude<TemplateStatus, "pending">
  vcpu: number
  memory_mib: number
  disk_mib: number
  created_at: string
  build_id: string
}

export interface TemplateResponse {
  id: string
  team_id: string
  alias: string
  status: TemplateStatus
  vcpu: number
  memory_mib: number
  disk_mib: number
  size_bytes?: number
  error_message?: string
  created_at: string
  built_at?: string
}

export interface TemplateBuildResponse {
  id: string
  template_id: string
  status: BuildStatus
  build_spec_hash: string
  error_message?: string
  started_at?: string
  finalized_at?: string
  created_at: string
}

export interface BuildLogEvent {
  timestamp: string
  stream: "stdout" | "stderr" | "system"
  text: string
  finished?: boolean
  status?: "ready" | "failed" | "cancelled"
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS. If unrelated errors exist, confirm none of them originate from `types.ts`.

- [ ] **Step 3: Checkpoint**

No runtime changes yet; file is consumed in later tasks.

---

## Task 2: Allow `/templates` through the proxy

**Files:**
- Modify: `apps/console/src/app/api/[...path]/route.ts:7`

- [ ] **Step 1: Add `"templates"` to `ALLOWED_PREFIXES`**

Change:

```ts
const ALLOWED_PREFIXES = ["sandboxes", "health", "v1"]
```

to:

```ts
const ALLOWED_PREFIXES = ["sandboxes", "health", "v1", "templates"]
```

- [ ] **Step 2: Typecheck**

Run: `bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS.

- [ ] **Step 3: Smoke test via curl (once dev server is running later)**

Defer to Task 20 verification — at this stage there is no handler calling `/api/templates` yet.

---

## Task 3: Stream `text/event-stream` responses through the proxy

**Files:**
- Modify: `apps/console/src/app/api/[...path]/route.ts`

**Why:** The current proxy calls `response.arrayBuffer()`, which buffers the upstream body. SSE must be streamed through, or the browser receives nothing until the build is done.

- [ ] **Step 1: Branch on content-type**

Replace the body-reading section (starting around line 91 `// Per the Fetch spec, …` through line 105 `}`) with:

```ts
const isNullBodyStatus =
  response.status === 204 ||
  response.status === 205 ||
  response.status === 304

const upstreamContentType = response.headers.get("content-type") ?? ""
const isEventStream = upstreamContentType.includes("text/event-stream")

if (isNullBodyStatus) {
  return new NextResponse(null, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

if (isEventStream) {
  responseHeaders.set("cache-control", "no-cache, no-transform")
  responseHeaders.set("connection", "keep-alive")
  responseHeaders.set("x-accel-buffering", "no")
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

const data = await response.arrayBuffer()
return new NextResponse(data, {
  status: response.status,
  statusText: response.statusText,
  headers: responseHeaders,
})
```

- [ ] **Step 2: Typecheck**

Run: `bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS.

- [ ] **Step 3: Lint**

Run: `bunx biome check --write apps/console/src/app/api/[...path]/route.ts`

Expected: no violations.

- [ ] **Step 4: Checkpoint**

Streaming behaviour is verified end-to-end in Task 17 once the SSE viewer is wired.

---

## Task 4: Add `templateKeys` to query-keys

**Files:**
- Modify: `apps/console/src/lib/api/query-keys.ts`

- [ ] **Step 1: Append `templateKeys`**

Append to the end of the file:

```ts
export const templateKeys = {
  all: ["templates"] as const,
  lists: () => [...templateKeys.all, "list"] as const,
  list: (filters?: { alias_prefix?: string }) =>
    [...templateKeys.lists(), filters ?? {}] as const,
  details: () => [...templateKeys.all, "detail"] as const,
  detail: (id: string) => [...templateKeys.details(), id] as const,
  builds: (templateId: string) =>
    [...templateKeys.detail(templateId), "builds"] as const,
  build: (templateId: string, buildId: string) =>
    [...templateKeys.builds(templateId), buildId] as const,
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS.

---

## Task 5: API client wrappers for templates

**Files:**
- Create: `apps/console/src/lib/api/templates.ts`

- [ ] **Step 1: Write the client**

```ts
import { apiClient } from "./client"
import type {
  CreateTemplateRequest,
  CreateTemplateResponse,
  TemplateBuildResponse,
  TemplateResponse,
} from "./types"

export async function listTemplates(params?: {
  alias_prefix?: string
}): Promise<TemplateResponse[]> {
  const query = new URLSearchParams()
  if (params?.alias_prefix) query.set("alias_prefix", params.alias_prefix)
  const suffix = query.toString()
  return apiClient<TemplateResponse[]>(
    `/templates${suffix ? `?${suffix}` : ""}`,
  )
}

export async function getTemplate(id: string): Promise<TemplateResponse> {
  return apiClient<TemplateResponse>(`/templates/${id}`)
}

export async function createTemplate(
  data: CreateTemplateRequest,
): Promise<CreateTemplateResponse> {
  return apiClient<CreateTemplateResponse>("/templates", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function deleteTemplate(id: string): Promise<void> {
  return apiClient<void>(`/templates/${id}`, { method: "DELETE" })
}

export async function listTemplateBuilds(
  templateId: string,
  params?: { limit?: number },
): Promise<TemplateBuildResponse[]> {
  const query = new URLSearchParams()
  if (params?.limit) query.set("limit", String(params.limit))
  const suffix = query.toString()
  return apiClient<TemplateBuildResponse[]>(
    `/templates/${templateId}/builds${suffix ? `?${suffix}` : ""}`,
  )
}

export async function createTemplateBuild(
  templateId: string,
): Promise<TemplateBuildResponse> {
  return apiClient<TemplateBuildResponse>(
    `/templates/${templateId}/builds`,
    { method: "POST" },
  )
}

export async function getTemplateBuild(
  templateId: string,
  buildId: string,
): Promise<TemplateBuildResponse> {
  return apiClient<TemplateBuildResponse>(
    `/templates/${templateId}/builds/${buildId}`,
  )
}

export async function cancelTemplateBuild(
  templateId: string,
  buildId: string,
): Promise<void> {
  return apiClient<void>(`/templates/${templateId}/builds/${buildId}`, {
    method: "DELETE",
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS.

---

## Task 6: `isSystemTemplate` predicate + test

**Files:**
- Create: `apps/console/src/lib/templates/is-system-template.ts`
- Test: `apps/console/src/lib/templates/is-system-template.test.ts`

**Context:** The predicate is the single point of change if the backend signal for system templates differs from what we assume. Start with the simplest assumption: team templates have a concrete `team_id`; system/curated templates either have a sentinel value (e.g., the well-known system team id) or a distinct marker later. For v1 we compare against the caller's current `team_id`, which is exposed via the existing team context. If no team context is available, all templates are treated as team (safe default).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import type { TemplateResponse } from "../api/types"
import { isSystemTemplate } from "./is-system-template"

const t = (teamId: string): TemplateResponse => ({
  id: "id",
  team_id: teamId,
  alias: "a",
  status: "ready",
  vcpu: 1,
  memory_mib: 1024,
  disk_mib: 4096,
  created_at: "2026-04-20T00:00:00Z",
})

describe("isSystemTemplate", () => {
  it("returns true when the template's team_id does not match the caller's", () => {
    expect(isSystemTemplate(t("system-team"), "my-team")).toBe(true)
  })

  it("returns false when the team_ids match", () => {
    expect(isSystemTemplate(t("my-team"), "my-team")).toBe(false)
  })

  it("returns false when caller team is unknown", () => {
    expect(isSystemTemplate(t("any"), null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx turbo run test --filter=@superserve/console -- is-system-template`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement**

```ts
import type { TemplateResponse } from "../api/types"

export function isSystemTemplate(
  template: TemplateResponse,
  callerTeamId: string | null,
): boolean {
  if (!callerTeamId) return false
  return template.team_id !== callerTeamId
}
```

- [ ] **Step 4: Run test — PASS**

Run: `bunx turbo run test --filter=@superserve/console -- is-system-template`

Expected: 3 passing.

---

## Task 7: `formatBuildError` humanizer + test

**Files:**
- Create: `apps/console/src/lib/templates/format-build-error.ts`
- Test: `apps/console/src/lib/templates/format-build-error.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { formatBuildError } from "./format-build-error"

describe("formatBuildError", () => {
  it("humanizes image_pull_failed", () => {
    expect(
      formatBuildError(
        "image_pull_failed: manifest not found for python:3.99",
      ),
    ).toEqual({
      title: "Failed to pull base image",
      detail: "manifest not found for python:3.99",
    })
  })

  it("humanizes step_failed", () => {
    expect(
      formatBuildError("step_failed: step 1/2 failed after 3s: exit 100"),
    ).toEqual({
      title: "A build step failed",
      detail: "step 1/2 failed after 3s: exit 100",
    })
  })

  it("falls back cleanly on unknown codes", () => {
    expect(formatBuildError("something_weird: oops")).toEqual({
      title: "Build failed",
      detail: "something_weird: oops",
    })
  })

  it("handles undefined", () => {
    expect(formatBuildError(undefined)).toEqual({
      title: "Build failed",
      detail: "",
    })
  })
})
```

- [ ] **Step 2: Run — FAIL**

Run: `bunx turbo run test --filter=@superserve/console -- format-build-error`

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
const TITLES: Record<string, string> = {
  image_pull_failed: "Failed to pull base image",
  step_failed: "A build step failed",
  boot_failed: "Build VM failed to boot",
  snapshot_failed: "Snapshot creation failed",
  start_cmd_failed: "Start command failed",
  ready_cmd_failed: "Readiness check failed",
  build_failed: "Build failed",
}

export interface FormattedBuildError {
  title: string
  detail: string
}

export function formatBuildError(
  raw: string | undefined,
): FormattedBuildError {
  if (!raw) return { title: "Build failed", detail: "" }
  const match = raw.match(/^([a-z_]+):\s*(.*)$/s)
  if (!match) return { title: "Build failed", detail: raw }
  const [, code, rest] = match
  return { title: TITLES[code] ?? "Build failed", detail: rest.trim() }
}
```

- [ ] **Step 4: Run — PASS**

Run: `bunx turbo run test --filter=@superserve/console -- format-build-error`

Expected: 4 passing.

---

## Task 8: React Query hooks

**Files:**
- Create: `apps/console/src/hooks/use-templates.ts`

**Context:** Mirrors `use-sandboxes.ts`. Invalidate list + detail after each mutation. Detail polling pauses on terminal status.

- [ ] **Step 1: Write the hooks**

```ts
"use client"

import { useToast } from "@superserve/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError } from "@/lib/api/client"
import { templateKeys } from "@/lib/api/query-keys"
import {
  cancelTemplateBuild,
  createTemplate,
  createTemplateBuild,
  deleteTemplate,
  getTemplate,
  getTemplateBuild,
  listTemplateBuilds,
  listTemplates,
} from "@/lib/api/templates"
import type {
  CreateTemplateRequest,
  TemplateResponse,
} from "@/lib/api/types"

const TERMINAL_TEMPLATE_STATUSES = new Set(["ready", "failed"])
const TERMINAL_BUILD_STATUSES = new Set(["ready", "failed", "cancelled"])

export function useTemplates(aliasPrefix?: string) {
  return useQuery({
    queryKey: templateKeys.list({ alias_prefix: aliasPrefix }),
    queryFn: () =>
      listTemplates(aliasPrefix ? { alias_prefix: aliasPrefix } : undefined),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  })
}

export function useTemplate(id: string | null) {
  return useQuery({
    queryKey: templateKeys.detail(id ?? ""),
    queryFn: () => getTemplate(id as string),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (!status) return false
      return TERMINAL_TEMPLATE_STATUSES.has(status) ? false : 5_000
    },
    refetchOnWindowFocus: true,
  })
}

export function useTemplateBuilds(templateId: string | null) {
  return useQuery({
    queryKey: templateKeys.builds(templateId ?? ""),
    queryFn: () => listTemplateBuilds(templateId as string, { limit: 20 }),
    enabled: !!templateId,
    refetchInterval: (query) => {
      const latest = query.state.data?.[0]
      if (!latest) return 5_000
      return TERMINAL_BUILD_STATUSES.has(latest.status) ? false : 5_000
    },
  })
}

export function useTemplateBuild(
  templateId: string | null,
  buildId: string | null,
) {
  return useQuery({
    queryKey: templateKeys.build(templateId ?? "", buildId ?? ""),
    queryFn: () =>
      getTemplateBuild(templateId as string, buildId as string),
    enabled: !!templateId && !!buildId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (!status) return false
      return TERMINAL_BUILD_STATUSES.has(status) ? false : 3_000
    },
  })
}

export function useCreateTemplate() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (data: CreateTemplateRequest) => createTemplate(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
      addToast(`Template "${created.alias}" created — build queued`, "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to create template. Check your plan limits or try again."
      addToast(message, "error")
    },
  })
}

export function useRebuildTemplate() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (templateId: string) => createTemplateBuild(templateId),
    onSuccess: (_build, templateId) => {
      queryClient.invalidateQueries({
        queryKey: templateKeys.detail(templateId),
      })
      queryClient.invalidateQueries({
        queryKey: templateKeys.builds(templateId),
      })
      addToast("Rebuild queued", "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Failed to rebuild template."
      addToast(message, "error")
    },
  })
}

export function useCancelTemplateBuild(templateId: string) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (buildId: string) => cancelTemplateBuild(templateId, buildId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: templateKeys.detail(templateId),
      })
      queryClient.invalidateQueries({
        queryKey: templateKeys.builds(templateId),
      })
      addToast("Build cancelled", "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Failed to cancel build."
      addToast(message, "error")
    },
  })
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: templateKeys.lists() })
      const snapshots = queryClient.getQueriesData<TemplateResponse[]>({
        queryKey: templateKeys.lists(),
      })
      for (const [key, data] of snapshots) {
        if (!data) continue
        queryClient.setQueryData<TemplateResponse[]>(
          key,
          data.filter((t) => t.id !== id),
        )
      }
      return { snapshots }
    },
    onError: (error, _id, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data)
      }
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to delete template."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
    },
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS.

---

## Task 9: Sidebar entry

**Files:**
- Modify: `apps/console/src/components/sidebar/nav-config.ts`

- [ ] **Step 1: Add the import and nav item**

Edit `nav-config.ts`:

```ts
import type { Icon } from "@phosphor-icons/react"
import {
  BookOpenIcon,
  ChartBarIcon,
  ClipboardTextIcon,
  CubeIcon,
  GearIcon,
  KeyIcon,
  LifebuoyIcon,
  StackIcon,
} from "@phosphor-icons/react"
```

and:

```ts
export const mainNavItems: NavItem[] = [
  { label: "Sandboxes", href: "/sandboxes", icon: CubeIcon },
  { label: "Templates", href: "/templates", icon: StackIcon },
  { label: "Audit Logs", href: "/audit-logs", icon: ClipboardTextIcon },
  { label: "API Keys", href: "/api-keys", icon: KeyIcon },
  { label: "Plan & Usage", href: "/plan-usage", icon: ChartBarIcon },
  { label: "Settings", href: "/settings", icon: GearIcon },
]
```

- [ ] **Step 2: Lint + typecheck**

Run: `bunx biome check --write apps/console/src/components/sidebar/nav-config.ts && bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS.

---

## Task 10: Status badge + resources helper components

**Files:**
- Create: `apps/console/src/components/templates/template-status-badge.tsx`
- Create: `apps/console/src/components/templates/template-resources.tsx`

- [ ] **Step 1: Status badge**

```tsx
import { Badge } from "@superserve/ui"
import type { TemplateStatus, BuildStatus } from "@/lib/api/types"

type Status = TemplateStatus | BuildStatus

const VARIANT: Record<
  Status,
  "default" | "success" | "warning" | "destructive" | "muted"
> = {
  pending: "muted",
  building: "warning",
  snapshotting: "warning",
  ready: "success",
  failed: "destructive",
  cancelled: "muted",
}

const LABEL: Record<Status, string> = {
  pending: "Pending",
  building: "Building",
  snapshotting: "Snapshotting",
  ready: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
}

export function TemplateStatusBadge({ status }: { status: Status }) {
  return (
    <Badge variant={VARIANT[status]} dot>
      {LABEL[status]}
    </Badge>
  )
}
```

> Note: if the existing `Badge` API differs (e.g. `variant` names are different or `dot` is not a prop), adapt to the actual signature. The executor should read `packages/ui/src/components/badge.tsx` before writing this file and adjust the prop names accordingly — the behaviour (colored dot + label) is what matters.

- [ ] **Step 2: Resources helper**

```tsx
export function TemplateResources({
  vcpu,
  memoryMib,
  diskMib,
  className,
}: {
  vcpu: number
  memoryMib: number
  diskMib: number
  className?: string
}) {
  const mem = memoryMib >= 1024 ? `${memoryMib / 1024} GB` : `${memoryMib} MiB`
  const disk = diskMib >= 1024 ? `${diskMib / 1024} GB` : `${diskMib} MiB`
  return (
    <span
      className={`font-mono text-xs text-muted-foreground ${className ?? ""}`}
    >
      {vcpu} vCPU · {mem} · {disk}
    </span>
  )
}
```

- [ ] **Step 3: Lint + typecheck**

Run: `bunx biome check --write apps/console/src/components/templates && bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS.

---

## Task 11: List page scaffold (route, page shell, empty / error / loading states)

**Files:**
- Create: `apps/console/src/app/(dashboard)/templates/page.tsx`
- Create: `apps/console/src/app/(dashboard)/templates/loading.tsx`

**Context:** Mirror the top of `sandboxes/page.tsx`. Create button in the header opens `CreateTemplateDialog` (Task 13). The initial page renders without tabs or search — those land in Task 12.

- [ ] **Step 1: `loading.tsx`**

```tsx
import { PageHeader } from "@/components/page-header"
import { TableSkeleton } from "@/components/table-skeleton"

export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Templates" />
      <div className="flex-1 overflow-auto p-6">
        <TableSkeleton rows={6} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `page.tsx` (initial skeleton — list rendering only)**

```tsx
"use client"

import { PlusIcon, StackIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import { useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import {
  StickyHoverTableBody,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/table"
import { TableSkeleton } from "@/components/table-skeleton"
import { CreateTemplateDialog } from "@/components/templates/create-template-dialog"
import { TemplateTableRow } from "@/components/templates/template-table-row"
import { useTemplates } from "@/hooks/use-templates"

export default function TemplatesPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const { data, isLoading, isError, refetch } = useTemplates()

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Templates"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-3.5" weight="light" />
            <span className="font-mono uppercase text-xs">New template</span>
          </Button>
        }
      />

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={6} />
          </div>
        ) : isError ? (
          <ErrorState
            title="Couldn't load templates"
            message="Something went wrong while fetching templates."
            onRetry={() => refetch()}
          />
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={StackIcon}
            title="No templates yet"
            description="Templates are pre-baked VM images your sandboxes boot from."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <PlusIcon className="size-3.5" weight="light" />
                <span className="font-mono uppercase text-xs">Create template</span>
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alias</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Resources</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Built</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <StickyHoverTableBody>
              {data.map((t) => (
                <TemplateTableRow key={t.id} template={t} />
              ))}
            </StickyHoverTableBody>
          </Table>
        )}
      </div>

      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  )
}
```

> The executor MUST read `sandboxes/page.tsx` to confirm the exact import paths for `Table`, `TableHead`, `StickyHoverTableBody`, `PageHeader`, `EmptyState`, `ErrorState`, `TableSkeleton`. Paths in the snippet above are the likely ones — adjust to whatever the codebase actually uses.

- [ ] **Step 3: Lint + typecheck**

Expected: will fail on `TemplateTableRow` and `CreateTemplateDialog` imports. Those land in Tasks 12 and 13 — leave the code as-is and move on. The next verification checkpoint is Task 13's end.

---

## Task 12: Table row + row actions

**Files:**
- Create: `apps/console/src/components/templates/template-table-row.tsx`
- Create: `apps/console/src/components/templates/template-row-actions.tsx`
- Create: `apps/console/src/components/templates/delete-template-dialog.tsx`

- [ ] **Step 1: `delete-template-dialog.tsx`**

```tsx
"use client"

import { Button, Dialog, DialogContent, DialogTitle } from "@superserve/ui"
import { ApiError } from "@/lib/api/client"
import { useDeleteTemplate } from "@/hooks/use-templates"
import type { TemplateResponse } from "@/lib/api/types"

export function DeleteTemplateDialog({
  template,
  open,
  onOpenChange,
  onDeleted,
}: {
  template: TemplateResponse | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onDeleted?: () => void
}) {
  const mutation = useDeleteTemplate()

  const handleDelete = async () => {
    if (!template) return
    try {
      await mutation.mutateAsync(template.id)
      onOpenChange(false)
      onDeleted?.()
    } catch (err) {
      // toast shown by hook; leave dialog open so user can see context
      if (err instanceof ApiError && err.status === 409) {
        // 409 surfaces via toast; no extra UI needed
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Delete template</DialogTitle>
        <p className="text-sm text-muted-foreground">
          This will soft-delete{" "}
          <span className="font-mono text-foreground">
            {template?.alias}
          </span>
          . Sandboxes still using this template will block the delete — stop or
          delete them first.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: `template-row-actions.tsx`**

```tsx
"use client"

import {
  ArrowsClockwiseIcon,
  CopyIcon,
  DotsThreeVerticalIcon,
  RocketLaunchIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useToast,
} from "@superserve/ui"
import { useState } from "react"
import { ApiError } from "@/lib/api/client"
import { useRebuildTemplate } from "@/hooks/use-templates"
import type { TemplateResponse } from "@/lib/api/types"
import { DeleteTemplateDialog } from "./delete-template-dialog"

export function TemplateRowActions({
  template,
  isSystem,
  onLaunch,
}: {
  template: TemplateResponse
  isSystem: boolean
  onLaunch: (t: TemplateResponse) => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const rebuild = useRebuildTemplate()
  const { addToast } = useToast()

  const copy = (value: string, label: string) => {
    navigator.clipboard.writeText(value)
    addToast(`${label} copied`, "success")
  }

  const handleRebuild = async () => {
    try {
      await rebuild.mutateAsync(template.id)
    } catch (err) {
      if (err instanceof ApiError && err.status === 200) {
        addToast("A build is already in progress", "info")
      }
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Template actions">
            <DotsThreeVerticalIcon className="size-4" weight="light" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onLaunch(template)}>
            <RocketLaunchIcon className="size-4" weight="light" />
            Launch sandbox
          </DropdownMenuItem>
          {!isSystem && (
            <DropdownMenuItem
              onSelect={handleRebuild}
              disabled={template.status === "building"}
            >
              <ArrowsClockwiseIcon className="size-4" weight="light" />
              Rebuild
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => copy(template.alias, "Alias")}>
            <CopyIcon className="size-4" weight="light" />
            Copy alias
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copy(template.id, "ID")}>
            <CopyIcon className="size-4" weight="light" />
            Copy ID
          </DropdownMenuItem>
          {!isSystem && (
            <DropdownMenuItem
              onSelect={() => setDeleteOpen(true)}
              variant="destructive"
            >
              <TrashIcon className="size-4" weight="light" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteTemplateDialog
        template={template}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  )
}
```

> Adjust `Button`, `DropdownMenu*`, `useToast`, and size tokens to match what `@superserve/ui` actually exports. Read `packages/ui/src/components/dropdown-menu.tsx` and `packages/ui/src/index.ts` before writing.

- [ ] **Step 3: `template-table-row.tsx`**

```tsx
"use client"

import { useRouter } from "next/navigation"
import { TableCell, TableRow } from "@/components/table"
import { useAuthContext } from "@/hooks/use-auth-context" // or whichever hook exposes the team id
import type { TemplateResponse } from "@/lib/api/types"
import { formatBytes } from "@/lib/format-bytes"
import { formatDistanceToNow } from "@/lib/format-time"
import { isSystemTemplate } from "@/lib/templates/is-system-template"
import { TemplateResources } from "./template-resources"
import { TemplateRowActions } from "./template-row-actions"
import { TemplateStatusBadge } from "./template-status-badge"

export function TemplateTableRow({
  template,
}: {
  template: TemplateResponse
}) {
  const router = useRouter()
  const { teamId } = useAuthContext()
  const system = isSystemTemplate(template, teamId)

  const handleLaunch = (t: TemplateResponse) => {
    router.push(`/sandboxes?from_template=${encodeURIComponent(t.alias)}`)
  }

  return (
    <TableRow
      onClick={() => router.push(`/templates/${template.id}`)}
      className="cursor-pointer"
    >
      <TableCell className="font-mono">{template.alias}</TableCell>
      <TableCell>
        <TemplateStatusBadge status={template.status} />
      </TableCell>
      <TableCell>
        <TemplateResources
          vcpu={template.vcpu}
          memoryMib={template.memory_mib}
          diskMib={template.disk_mib}
        />
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {template.size_bytes != null ? formatBytes(template.size_bytes) : "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {template.built_at
          ? formatDistanceToNow(template.built_at)
          : "Never"}
      </TableCell>
      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
        <TemplateRowActions
          template={template}
          isSystem={system}
          onLaunch={handleLaunch}
        />
      </TableCell>
    </TableRow>
  )
}
```

> The `useAuthContext` / `teamId` source depends on the existing codebase. If the team id is pulled from a Supabase hook or React context, use the actual one — read `apps/console/src/hooks/` and `apps/console/src/lib/supabase/` to find it. If no such hook exists, create a minimal `useTeamId` hook that reads from the server-provided session.

> The `formatBytes` and `formatDistanceToNow` helpers may live at different paths; match the existing utilities.

- [ ] **Step 4: Lint + typecheck**

Run: `bunx biome check --write apps/console/src/components/templates && bunx turbo run typecheck --filter=@superserve/console`

Fix any import-path issues revealed. Expected: typecheck still failing on missing `CreateTemplateDialog` — that lands in Task 13.

---

## Task 13: Create template dialog

**Files:**
- Create: `apps/console/src/components/templates/create-template-dialog.tsx`

- [ ] **Step 1: Write the dialog**

```tsx
"use client"

import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@superserve/ui"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { ApiError } from "@/lib/api/client"
import { useCreateTemplate } from "@/hooks/use-templates"

const CURATED_IMAGES = [
  "python:3.11",
  "python:3.12",
  "node:20-slim",
  "node:22-slim",
  "ubuntu:24.04",
  "debian:12-slim",
] as const

const MEMORY_OPTIONS = [256, 512, 1024, 2048, 4096] as const
const DISK_OPTIONS = [1024, 2048, 4096, 8192] as const
const VCPU_OPTIONS = [1, 2, 4] as const

const ALIAS_RE = /^[a-z0-9][a-z0-9-]*$/

function validateAlias(alias: string): string | null {
  if (!alias) return "Alias is required"
  if (alias.length > 128) return "Alias must be 128 characters or fewer"
  if (!ALIAS_RE.test(alias))
    return "Use lowercase letters, numbers, and hyphens; start with a letter or number"
  return null
}

function validateImage(image: string): string | null {
  if (!image) return "Base image is required"
  const lower = image.toLowerCase()
  if (lower.includes("alpine"))
    return "Alpine images are not supported. Pick a glibc-based image."
  if (lower.includes("distroless"))
    return "Distroless images are not supported."
  return null
}

export function CreateTemplateDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const router = useRouter()
  const create = useCreateTemplate()

  const [alias, setAlias] = useState("")
  const [imageMode, setImageMode] = useState<"curated" | "custom">("curated")
  const [curatedImage, setCuratedImage] = useState<string>(CURATED_IMAGES[1])
  const [customImage, setCustomImage] = useState("")
  const [vcpu, setVcpu] = useState<number>(1)
  const [memory, setMemory] = useState<number>(1024)
  const [disk, setDisk] = useState<number>(4096)
  const [errors, setErrors] = useState<{
    alias?: string
    image?: string
    form?: string
  }>({})

  const resetForm = () => {
    setAlias("")
    setImageMode("curated")
    setCuratedImage(CURATED_IMAGES[1])
    setCustomImage("")
    setVcpu(1)
    setMemory(1024)
    setDisk(4096)
    setErrors({})
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const image = imageMode === "curated" ? curatedImage : customImage.trim()

    const aliasError = validateAlias(alias.trim())
    const imageError = validateImage(image)
    if (aliasError || imageError) {
      setErrors({
        alias: aliasError ?? undefined,
        image: imageError ?? undefined,
      })
      return
    }
    setErrors({})

    try {
      const created = await create.mutateAsync({
        alias: alias.trim(),
        vcpu,
        memory_mib: memory,
        disk_mib: disk,
        build_spec: { from: image },
      })
      onOpenChange(false)
      resetForm()
      router.push(`/templates/${created.id}`)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setErrors({ alias: "An alias with this name already exists." })
          return
        }
        if (err.status === 429) {
          setErrors({
            form:
              "Concurrent build limit reached. Wait for a build to finish, then try again.",
          })
          return
        }
        setErrors({ form: err.message })
        return
      }
      setErrors({ form: "Something went wrong. Try again." })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) resetForm()
      }}
    >
      <DialogContent>
        <DialogTitle>New template</DialogTitle>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="tpl-alias">Alias</Label>
            <Input
              id="tpl-alias"
              autoFocus
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="e.g. python-ml"
              aria-invalid={!!errors.alias}
            />
            {errors.alias && (
              <p className="text-xs text-destructive">{errors.alias}</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label>Base image</Label>
            <div className="flex gap-2">
              <Select
                value={imageMode === "curated" ? curatedImage : "__custom__"}
                onValueChange={(v) => {
                  if (v === "__custom__") {
                    setImageMode("custom")
                  } else {
                    setImageMode("curated")
                    setCuratedImage(v)
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURATED_IMAGES.map((img) => (
                    <SelectItem key={img} value={img}>
                      {img}
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">Custom…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {imageMode === "custom" && (
              <Input
                className="mt-2"
                value={customImage}
                onChange={(e) => setCustomImage(e.target.value)}
                placeholder="e.g. ghcr.io/myorg/base:v1"
                aria-invalid={!!errors.image}
              />
            )}
            {errors.image && (
              <p className="text-xs text-destructive">{errors.image}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <Label>vCPU</Label>
              <div className="flex border border-dashed border-border">
                {VCPU_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setVcpu(n)}
                    className={`flex-1 font-mono text-xs uppercase py-2 ${
                      vcpu === n
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label>Memory</Label>
              <Select
                value={String(memory)}
                onValueChange={(v) => setMemory(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMORY_OPTIONS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m >= 1024 ? `${m / 1024} GB` : `${m} MiB`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label>Disk</Label>
              <Select
                value={String(disk)}
                onValueChange={(v) => setDisk(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISK_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d / 1024} GB
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {errors.form && (
            <p className="border border-dashed border-destructive p-3 text-xs text-destructive">
              {errors.form}
            </p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create & build"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

> Confirm `Select`, `Dialog`, `Input`, `Label` exist in `@superserve/ui` with these signatures. If the dialog ships a different API (e.g. `DialogHeader` required, different prop names), adjust.

- [ ] **Step 2: Lint + typecheck**

Run: `bunx biome check --write apps/console/src/components/templates && bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Run: `bun --filter @superserve/console run dev`

In the browser:
- Click **Templates** in the sidebar.
- Click **New template**, open the dialog, type an alias with invalid chars — error shows.
- Switch to Custom base image, enter `alpine:3.18` — error shows.
- Submit a valid form. Confirm it POSTs to `/api/templates` (Network tab) and, on success, navigates to `/templates/<id>`. The detail page won't exist yet — Task 15 — so expect the router to resolve to a 404 placeholder. That's fine.

---

## Task 14: Tabs + alias-prefix search on list

**Files:**
- Modify: `apps/console/src/app/(dashboard)/templates/page.tsx`

**Context:** Tabs are `All / Team / System`. Team and System counts are derived from the single fetched list using `isSystemTemplate`. The search box maps to the `alias_prefix` query param (debounced). Same fetched list is reused — no separate queries per tab.

- [ ] **Step 1: Lift state and filter**

Replace the body of `page.tsx` (keeping `CreateTemplateDialog` unchanged) with:

```tsx
"use client"

import { PlusIcon, StackIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import {
  StickyHoverTableBody,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar, TableToolbarTabs } from "@/components/table-toolbar"
import { CreateTemplateDialog } from "@/components/templates/create-template-dialog"
import { TemplateTableRow } from "@/components/templates/template-table-row"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useAuthContext } from "@/hooks/use-auth-context"
import { useTemplates } from "@/hooks/use-templates"
import { isSystemTemplate } from "@/lib/templates/is-system-template"

type Tab = "all" | "team" | "system"

export default function TemplatesPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const [tab, setTab] = useState<Tab>("all")
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search, 300)

  const { teamId } = useAuthContext()
  const {
    data: templates,
    isLoading,
    isError,
    refetch,
  } = useTemplates(debouncedSearch || undefined)

  const tabbed = useMemo(() => {
    if (!templates) return []
    if (tab === "all") return templates
    if (tab === "team")
      return templates.filter((t) => !isSystemTemplate(t, teamId))
    return templates.filter((t) => isSystemTemplate(t, teamId))
  }, [templates, tab, teamId])

  const counts = useMemo(() => {
    if (!templates) return { all: 0, team: 0, system: 0 }
    let team = 0
    let system = 0
    for (const t of templates) {
      if (isSystemTemplate(t, teamId)) system++
      else team++
    }
    return { all: templates.length, team, system }
  }, [templates, teamId])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Templates"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-3.5" weight="light" />
            <span className="font-mono uppercase text-xs">New template</span>
          </Button>
        }
      />

      <TableToolbar
        tabs={
          <TableToolbarTabs
            value={tab}
            onChange={(v) => setTab(v as Tab)}
            tabs={[
              { value: "all", label: "All", count: counts.all },
              { value: "team", label: "Team", count: counts.team },
              { value: "system", label: "System", count: counts.system },
            ]}
          />
        }
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search aliases…"
      />

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={6} />
          </div>
        ) : isError ? (
          <ErrorState
            title="Couldn't load templates"
            message="Something went wrong while fetching templates."
            onRetry={() => refetch()}
          />
        ) : tabbed.length === 0 ? (
          <EmptyState
            icon={StackIcon}
            title={
              search
                ? "No templates match that search"
                : tab === "system"
                  ? "No system templates available"
                  : "No templates yet"
            }
            description={
              search
                ? undefined
                : "Templates are pre-baked VM images your sandboxes boot from."
            }
            action={
              !search && tab !== "system" ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <PlusIcon className="size-3.5" weight="light" />
                  <span className="font-mono uppercase text-xs">
                    Create template
                  </span>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alias</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Resources</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Built</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <StickyHoverTableBody>
              {tabbed.map((t) => (
                <TemplateTableRow key={t.id} template={t} />
              ))}
            </StickyHoverTableBody>
          </Table>
        )}
      </div>

      <CreateTemplateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
```

> Before writing: read `apps/console/src/components/table-toolbar.tsx` to confirm the real prop names. If the toolbar exposes `TabsRoot`/`TabsTrigger` rather than `TableToolbarTabs`, use those. If `useDebouncedValue` doesn't exist, create it at `apps/console/src/hooks/use-debounced-value.ts`:
>
> ```ts
> import { useEffect, useState } from "react"
> export function useDebouncedValue<T>(value: T, delay: number): T {
>   const [debounced, setDebounced] = useState(value)
>   useEffect(() => {
>     const t = setTimeout(() => setDebounced(value), delay)
>     return () => clearTimeout(t)
>   }, [value, delay])
>   return debounced
> }
> ```

- [ ] **Step 2: Lint + typecheck**

Run: `bunx biome check --write apps/console && bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Open `/templates`. Confirm:
- Tabs render with counts.
- Typing in search hits `/api/templates?alias_prefix=<q>` after 300 ms (Network tab).
- Switching tabs doesn't refetch (same query data, filtered client-side).
- Empty-state copy changes for `System` vs `Team`, and when search yields no matches.

---

## Task 15: Detail page skeleton + info grid + build spec preview

**Files:**
- Create: `apps/console/src/app/(dashboard)/templates/[template_id]/page.tsx`
- Create: `apps/console/src/app/(dashboard)/templates/[template_id]/loading.tsx`
- Create: `apps/console/src/components/templates/template-info-grid.tsx`
- Create: `apps/console/src/components/templates/build-spec-preview.tsx`

- [ ] **Step 1: `loading.tsx`**

```tsx
import { PageHeader } from "@/components/page-header"

export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Loading…" />
    </div>
  )
}
```

- [ ] **Step 2: `template-info-grid.tsx`**

```tsx
import type { TemplateResponse } from "@/lib/api/types"
import { formatBytes } from "@/lib/format-bytes"
import { formatDistanceToNow } from "@/lib/format-time"
import { TemplateResources } from "./template-resources"

export function TemplateInfoGrid({ template }: { template: TemplateResponse }) {
  const items: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: "Resources",
      value: (
        <TemplateResources
          vcpu={template.vcpu}
          memoryMib={template.memory_mib}
          diskMib={template.disk_mib}
        />
      ),
    },
    {
      label: "Size",
      value: (
        <span className="font-mono text-xs text-muted-foreground">
          {template.size_bytes != null
            ? formatBytes(template.size_bytes)
            : "—"}
        </span>
      ),
    },
    {
      label: "Created",
      value: (
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(template.created_at)}
        </span>
      ),
    },
    {
      label: "Last built",
      value: (
        <span className="text-xs text-muted-foreground">
          {template.built_at ? formatDistanceToNow(template.built_at) : "Never"}
        </span>
      ),
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="border border-dashed border-border p-4"
        >
          <div className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            {item.label}
          </div>
          <div className="mt-2">{item.value}</div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: `build-spec-preview.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import type { BuildSpec } from "@/lib/api/types"

export function BuildSpecPreview({ spec }: { spec: BuildSpec }) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { codeToHtml } = await import("shiki")
      const out = await codeToHtml(JSON.stringify(spec, null, 2), {
        lang: "json",
        theme: "github-dark",
      })
      if (!cancelled) setHtml(out)
    })()
    return () => {
      cancelled = true
    }
  }, [spec])

  return (
    <div className="border border-dashed border-border">
      <div className="border-b border-dashed border-border px-4 py-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
        Build spec
      </div>
      <div
        className="[&_pre]:overflow-auto [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-xs"
        dangerouslySetInnerHTML={
          html
            ? { __html: html }
            : {
                __html: `<pre>${escapeHtml(JSON.stringify(spec, null, 2))}</pre>`,
              }
        }
      />
    </div>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
```

> Verify `shiki` is already a dependency (console uses it for code highlighting). If not, add it via `bun add shiki --filter @superserve/console` from the repo root.

- [ ] **Step 4: `page.tsx` (detail page — header, info grid, spec preview only; build panels added in later tasks)**

```tsx
"use client"

import { ArrowLeftIcon, CopyIcon } from "@phosphor-icons/react"
import { Button, useToast } from "@superserve/ui"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { BuildHistorySection } from "@/components/templates/build-history-section"
import { BuildSpecPreview } from "@/components/templates/build-spec-preview"
import { CurrentBuildPanel } from "@/components/templates/current-build-panel"
import { TemplateInfoGrid } from "@/components/templates/template-info-grid"
import { TemplateStatusBadge } from "@/components/templates/template-status-badge"
import { useTemplate } from "@/hooks/use-templates"

export default function TemplateDetailPage() {
  const params = useParams<{ template_id: string }>()
  const router = useRouter()
  const { addToast } = useToast()
  const { data, isLoading, isError, error } = useTemplate(params.template_id)

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Loading…" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Template" />
        <ErrorState
          title="Template not found"
          message={
            error instanceof Error ? error.message : "This template could not be loaded."
          }
          action={
            <Button asChild variant="outline">
              <Link href="/templates">Back to templates</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const copyId = () => {
    navigator.clipboard.writeText(data.id)
    addToast("ID copied", "success")
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        breadcrumbs={[{ label: "Templates", href: "/templates" }]}
        title={
          <div className="flex items-center gap-3">
            <span className="font-mono">{data.alias}</span>
            <TemplateStatusBadge status={data.status} />
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            {/* Rebuild / Delete / Launch buttons added in Task 18. */}
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyId}
              className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              {data.id}
              <CopyIcon className="size-3.5" weight="light" />
            </button>
          </div>

          <TemplateInfoGrid template={data} />

          <CurrentBuildPanel templateId={data.id} />

          <BuildHistorySection templateId={data.id} />

          {/* BuildSpec preview will show whatever spec we stored; for Option-B
              creates this will be `{ "from": "<image>" }`. Templates created
              via SDK/CLI may carry richer specs. We don't currently fetch the
              spec from the list/get endpoints — add once the backend exposes
              it. Placeholder: omit rendering if not available. */}
          {/*
          {data.build_spec && <BuildSpecPreview spec={data.build_spec} />}
          */}
        </div>
      </div>
    </div>
  )
}
```

> `TemplateResponse` in the OpenAPI spec does NOT include `build_spec` — `BuildSpecPreview` is imported for future use but its call site stays commented until the backend returns the spec (or we fetch it from the build endpoint). Keep the component in the tree so tree-shaking removes it until referenced. Document this gap as a known limitation in the doc site after the feature ships.

- [ ] **Step 5: Lint + typecheck**

Will fail on missing `CurrentBuildPanel` and `BuildHistorySection` — those land in Tasks 16 and 17. Leave as-is.

---

## Task 16: Build history section

**Files:**
- Create: `apps/console/src/components/templates/build-history-section.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client"

import { CaretDownIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { useTemplateBuilds } from "@/hooks/use-templates"
import { formatBuildError } from "@/lib/templates/format-build-error"
import { formatDistanceToNow } from "@/lib/format-time"
import { BuildLogViewer } from "./build-log-viewer"
import { TemplateStatusBadge } from "./template-status-badge"

const TERMINAL = new Set(["ready", "failed", "cancelled"])

export function BuildHistorySection({ templateId }: { templateId: string }) {
  const { data, isLoading } = useTemplateBuilds(templateId)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const historical = (data ?? []).filter((b) => TERMINAL.has(b.status))

  if (isLoading) return null
  if (historical.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
        Build history
      </h2>
      <ul className="flex flex-col border border-dashed border-border">
        {historical.map((build) => {
          const expanded = expandedId === build.id
          const err = formatBuildError(build.error_message)
          return (
            <li
              key={build.id}
              className="border-b border-dashed border-border last:border-b-0"
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedId((prev) => (prev === build.id ? null : build.id))
                }
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
              >
                <CaretDownIcon
                  className={`size-4 transition-transform ${
                    expanded ? "" : "-rotate-90"
                  }`}
                  weight="light"
                />
                <TemplateStatusBadge status={build.status} />
                <span className="font-mono text-xs text-muted-foreground">
                  {build.started_at
                    ? formatDistanceToNow(build.started_at)
                    : formatDistanceToNow(build.created_at)}
                </span>
                {build.status === "failed" && err.title && (
                  <span className="font-mono text-xs text-destructive">
                    {err.title}
                  </span>
                )}
              </button>
              {expanded && (
                <div className="border-t border-dashed border-border p-4">
                  <BuildLogViewer
                    templateId={templateId}
                    buildId={build.id}
                    replayOnly
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Checkpoint**

Will fail until `BuildLogViewer` lands in Task 17.

---

## Task 17: Build log viewer (SSE)

**Files:**
- Create: `apps/console/src/components/templates/build-log-viewer.tsx`

**Context:** Uses the browser's `EventSource` against `/api/templates/{id}/builds/{buildId}/logs`. The proxy (Task 3) now passes `text/event-stream` through unbuffered. The viewer auto-scrolls when the user is near the bottom; if they scroll up, auto-scroll pauses and a "Jump to latest" pill appears. A 10k-line cap keeps memory bounded.

- [ ] **Step 1: Write the component**

```tsx
"use client"

import { ArrowDownIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import type { BuildLogEvent } from "@/lib/api/types"

interface LogLine {
  ts: string
  stream: BuildLogEvent["stream"]
  text: string
}

const MAX_LINES = 10_000

export function BuildLogViewer({
  templateId,
  buildId,
  replayOnly,
}: {
  templateId: string
  buildId: string
  replayOnly?: boolean
}) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [finalStatus, setFinalStatus] = useState<
    BuildLogEvent["status"] | null
  >(null)
  const [connError, setConnError] = useState<string | null>(null)
  const [autoFollow, setAutoFollow] = useState(true)
  const [attempt, setAttempt] = useState(0)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const url = `/api/templates/${templateId}/builds/${buildId}/logs`
    const es = new EventSource(url)
    setConnError(null)

    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as BuildLogEvent
        if (data.finished) {
          setFinalStatus(data.status ?? null)
          es.close()
          return
        }
        setLines((prev) => {
          const next = prev.concat({
            ts: data.timestamp,
            stream: data.stream,
            text: data.text,
          })
          if (next.length > MAX_LINES) {
            return next.slice(next.length - MAX_LINES)
          }
          return next
        })
      } catch {
        // ignore malformed events
      }
    }

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setConnError("Connection lost")
      }
    }

    return () => {
      es.close()
    }
  }, [templateId, buildId, attempt])

  useEffect(() => {
    if (autoFollow) {
      bottomRef.current?.scrollIntoView({ block: "end" })
    }
  }, [lines, autoFollow])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight
    setAutoFollow(distanceFromBottom < 24)
  }

  const jumpToLatest = () => {
    setAutoFollow(true)
    bottomRef.current?.scrollIntoView({ block: "end" })
  }

  return (
    <div className="relative border border-dashed border-border bg-background">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-[480px] overflow-auto p-4 font-mono text-xs"
      >
        {lines.length === 0 && !connError && !finalStatus && (
          <div className="text-muted-foreground">Waiting for log output…</div>
        )}
        {lines.map((l, i) => (
          <div key={i} className="flex gap-3 whitespace-pre-wrap break-words">
            <span className="text-muted-foreground/60 shrink-0">
              {l.ts.slice(11, 19)}
            </span>
            <span
              className={
                l.stream === "stderr"
                  ? "text-destructive"
                  : l.stream === "system"
                    ? "italic text-muted-foreground"
                    : "text-foreground"
              }
            >
              {l.text}
            </span>
          </div>
        ))}

        {finalStatus && (
          <div
            className={`mt-3 border border-dashed p-2 font-mono text-xs ${
              finalStatus === "ready"
                ? "border-green-500/50 text-green-400"
                : finalStatus === "failed"
                  ? "border-destructive text-destructive"
                  : "border-border text-muted-foreground"
            }`}
          >
            Build {finalStatus}
          </div>
        )}
        {connError && !finalStatus && (
          <div className="mt-3 flex items-center gap-3 border border-dashed border-destructive p-2 font-mono text-xs text-destructive">
            <span>{connError}</span>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="underline"
            >
              Reconnect
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!autoFollow && !finalStatus && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 right-3 flex items-center gap-1 border border-dashed border-border bg-background px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowDownIcon className="size-3" weight="light" />
          Jump to latest
        </button>
      )}
    </div>
  )
}
```

> `replayOnly` is a prop for future-proofing (e.g. for terminal builds in the history list where we don't want the "waiting" state); for v1 the component behaves identically regardless of the flag — the server replays from the start, and closes when `finished:true` arrives. Historical (terminal) builds will receive `finished:true` almost immediately, so there's no practical divergence.

- [ ] **Step 2: Lint + typecheck**

Run: `bunx biome check --write apps/console/src/components/templates/build-log-viewer.tsx && bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS.

---

## Task 18: Current build panel + detail header actions

**Files:**
- Create: `apps/console/src/components/templates/current-build-panel.tsx`
- Modify: `apps/console/src/app/(dashboard)/templates/[template_id]/page.tsx`

- [ ] **Step 1: `current-build-panel.tsx`**

```tsx
"use client"

import { StopCircleIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import { useMemo } from "react"
import {
  useCancelTemplateBuild,
  useTemplateBuilds,
} from "@/hooks/use-templates"
import { formatBuildError } from "@/lib/templates/format-build-error"
import { BuildLogViewer } from "./build-log-viewer"
import { TemplateStatusBadge } from "./template-status-badge"

const IN_FLIGHT = new Set(["pending", "building", "snapshotting"])

export function CurrentBuildPanel({ templateId }: { templateId: string }) {
  const { data } = useTemplateBuilds(templateId)
  const cancel = useCancelTemplateBuild(templateId)

  const latest = useMemo(() => data?.[0], [data])

  if (!latest) return null
  const isInFlight = IN_FLIGHT.has(latest.status)
  if (!isInFlight && latest.status !== "failed") return null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            {isInFlight ? "Current build" : "Last build"}
          </h2>
          <TemplateStatusBadge status={latest.status} />
        </div>
        {isInFlight && (
          <Button
            variant="outline"
            onClick={() => cancel.mutate(latest.id)}
            disabled={cancel.isPending}
          >
            <StopCircleIcon className="size-3.5" weight="light" />
            <span className="font-mono uppercase text-xs">
              {cancel.isPending ? "Cancelling…" : "Cancel build"}
            </span>
          </Button>
        )}
      </div>

      {latest.status === "failed" && (
        <div className="border border-dashed border-destructive p-3">
          <div className="font-mono text-xs text-destructive">
            {formatBuildError(latest.error_message).title}
          </div>
          {formatBuildError(latest.error_message).detail && (
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              {formatBuildError(latest.error_message).detail}
            </div>
          )}
        </div>
      )}

      <BuildLogViewer templateId={templateId} buildId={latest.id} />
    </section>
  )
}
```

- [ ] **Step 2: Wire rebuild / delete / launch actions into the detail header**

Replace the `actions` prop in `PageHeader` in `[template_id]/page.tsx` with:

```tsx
actions={
  <div className="flex items-center gap-2">
    {!isSystem && (
      <Button
        variant="outline"
        onClick={() => rebuild.mutate(data.id)}
        disabled={rebuild.isPending || data.status === "building"}
      >
        <ArrowsClockwiseIcon className="size-3.5" weight="light" />
        <span className="font-mono uppercase text-xs">Rebuild</span>
      </Button>
    )}
    {data.status === "ready" && (
      <Button
        onClick={() =>
          router.push(
            `/sandboxes?from_template=${encodeURIComponent(data.alias)}`,
          )
        }
      >
        <RocketLaunchIcon className="size-3.5" weight="light" />
        <span className="font-mono uppercase text-xs">Launch sandbox</span>
      </Button>
    )}
    {!isSystem && (
      <Button
        variant="outline"
        onClick={() => setDeleteOpen(true)}
      >
        <TrashIcon className="size-3.5" weight="light" />
        <span className="font-mono uppercase text-xs">Delete</span>
      </Button>
    )}
  </div>
}
```

and at the top of the component, add:

```tsx
import {
  ArrowsClockwiseIcon,
  RocketLaunchIcon,
  TrashIcon,
  ...
} from "@phosphor-icons/react"
import { useState } from "react"
import { DeleteTemplateDialog } from "@/components/templates/delete-template-dialog"
import { useAuthContext } from "@/hooks/use-auth-context"
import { useRebuildTemplate } from "@/hooks/use-templates"
import { isSystemTemplate } from "@/lib/templates/is-system-template"

// ...
const { teamId } = useAuthContext()
const rebuild = useRebuildTemplate()
const [deleteOpen, setDeleteOpen] = useState(false)
const isSystem = data ? isSystemTemplate(data, teamId) : false
```

And mount the delete dialog near the bottom of the JSX:

```tsx
<DeleteTemplateDialog
  template={data}
  open={deleteOpen}
  onOpenChange={setDeleteOpen}
  onDeleted={() => router.push("/templates")}
/>
```

- [ ] **Step 3: Lint + typecheck**

Run: `bunx biome check --write apps/console && bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS.

---

## Task 19: Launch-from-template wiring in the sandbox create dialog

**Files:**
- Modify: `apps/console/src/app/(dashboard)/sandboxes/page.tsx` (or the component that owns `CreateSandboxDialog`)
- Potentially modify: `apps/console/src/components/create-sandbox-dialog.tsx` (locate the actual path)

**Context:** The Launch actions in the template list/detail navigate to `/sandboxes?from_template=<alias>`. The sandboxes page should read the query param, open `CreateSandboxDialog` with the alias prefilled, and strip the query param after consumption.

- [ ] **Step 1: Locate the sandbox create dialog**

Read `apps/console/src/app/(dashboard)/sandboxes/page.tsx` to find the component that mounts `CreateSandboxDialog`. Note the exact prop shape for passing a prefilled template.

- [ ] **Step 2: Read the query param on mount and open the dialog**

```tsx
"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

// inside the page component:
const params = useSearchParams()
const router = useRouter()
const [createOpen, setCreateOpen] = useState(false)
const [prefilledTemplate, setPrefilledTemplate] = useState<string | null>(null)

useEffect(() => {
  const alias = params.get("from_template")
  if (alias) {
    setPrefilledTemplate(alias)
    setCreateOpen(true)
    // strip the param so a refresh doesn't re-open it
    const url = new URL(window.location.href)
    url.searchParams.delete("from_template")
    router.replace(url.pathname + (url.search || ""))
  }
}, [params, router])
```

Then pass `prefilledTemplate` into `CreateSandboxDialog`. If the dialog doesn't yet accept a prefilled template, extend it: add a prop `initialTemplate?: string`, and inside the dialog initialize the form's template field from it (falling back to the existing default). Keep the rest of the dialog unchanged.

- [ ] **Step 3: Verify the create-sandbox request uses the right field name**

The existing code sets `template_id` in `CreateSandboxRequest`, but the OpenAPI spec for this workstream uses `from_template` (accepting UUID or alias). Read `apps/console/src/lib/api/sandboxes.ts` and the current dialog to see which field is actually sent on the wire.

If the request still uses `template_id`: either (a) pass the alias as `template_id` and accept whatever the backend does — **do not** do this, it will silently break; or (b) update `CreateSandboxRequest`, the dialog, and the fetch to send `from_template` per the spec. Pick (b). Update `types.ts` accordingly:

```ts
export interface CreateSandboxRequest {
  name: string
  from_template?: string
  from_snapshot?: string
  timeout?: number
  env_vars?: Record<string, string>
  metadata?: Record<string, string>
  network?: NetworkConfig
}
```

Then update the dialog to populate `from_template` from the alias. If the existing sandboxes flow still uses `template_id` elsewhere, flag it and leave those untouched — they are outside this plan's scope. The minimum change is: the sandbox created via Launch-from-template uses `from_template`, matching the spec.

> If touching existing sandbox code feels risky, alternative: keep `template_id` for now and file a follow-up. The plan's Launch button still navigates correctly; only the API field lags. Prefer the proper fix if the blast radius is small.

- [ ] **Step 4: Lint + typecheck**

Run: `bunx biome check --write apps/console && bunx turbo run typecheck --filter=@superserve/console`

Expected: PASS.

---

## Task 20: Final verification

**Files:**
- (None — verification only)

- [ ] **Step 1: Typecheck the whole repo**

Run: `bun run typecheck`

Expected: PASS. Fix any issues that surfaced in the console workspace; do not attempt to fix unrelated packages.

- [ ] **Step 2: Lint**

Run: `bunx biome check --write apps/console`

Expected: no violations.

- [ ] **Step 3: Unit tests**

Run: `bunx turbo run test --filter=@superserve/console`

Expected: all passing, including the two new test files (`is-system-template.test.ts`, `format-build-error.test.ts`).

- [ ] **Step 4: Manual browser walk-through**

Run: `bun --filter @superserve/console run dev`

Open the console and verify, in order:

1. **Sidebar** — `Templates` appears between Sandboxes and Audit Logs, with the Stack icon. Clicking it routes to `/templates`.
2. **Empty state** — on a fresh team with no templates: empty state renders with the Create button. Clicking it opens the dialog.
3. **Create flow** —
   - Alias validation fires for empty / bad characters / length > 128.
   - Curated base image select shows the six images.
   - Switching to `Custom…` and entering `alpine:3.18` shows the "Alpine not supported" error; `python:3.11` passes.
   - Submitting a valid form navigates to the detail page with the `Current build` panel live-streaming logs.
4. **Live logs** — log lines stream in; stdout is foreground, stderr is red, system is italic muted. Timestamps render on the left.
5. **Auto-follow** — logs auto-scroll to bottom. Scroll up → auto-scroll stops and the "Jump to latest" pill appears. Clicking it re-engages auto-scroll.
6. **Terminal state** — build completes (`ready` or `failed`). The final banner appears. The viewer closes the EventSource (verify in devtools that the network row closes).
7. **Info grid** — after a successful build, Size and Last built populate.
8. **Rebuild** — click **Rebuild** on the detail page; a new build appears in the current-build panel and streams logs.
9. **Cancel build** — during an in-flight build, click **Cancel build**; status switches to `cancelled`; polling stops.
10. **Build history** — after several builds, the list shows up to 20, newest first. Expand a failed build; logs replay with the `failed` banner.
11. **List tabs + search** — on the list, filter by alias prefix; switch between All/Team/System tabs; counts update.
12. **Launch sandbox** — both the row kebab's "Launch sandbox" and the detail page's primary button navigate to `/sandboxes?from_template=<alias>`, opening the create-sandbox dialog with the alias prefilled. Creating the sandbox succeeds.
13. **Delete** — delete a template with no dependent sandboxes; it disappears from the list. Create a sandbox from a template, then try to delete the template; the 409 toast renders with the sandbox-dependency message.
14. **Error paths** — with the dev server, temporarily set an invalid `SANDBOX_API_URL` and verify the list error state renders and the Retry button works when the URL is restored.
15. **System templates** (if available in the test environment) — they appear in the System tab, and the Rebuild/Delete actions are hidden.

- [ ] **Step 5: Report status**

Report to the user:
- Typecheck: PASS/FAIL
- Lint: PASS/FAIL
- Tests: PASS/FAIL with counts
- Manual walk-through: checklist of verified items; anything deferred or broken

Do **not** create a git commit (per user preference). Stop and await further instructions.

---

## Notes on deferred work

- **`build_spec` on `TemplateResponse`** — the backend's `TemplateResponse` doesn't return the `build_spec`. The detail page's `BuildSpecPreview` is wired but kept commented. Once the backend adds the field (or a dedicated endpoint), uncomment and use.
- **Build step counts on live logs** — the `system` stream carries supervisor status text (step boundaries, snapshot phase). Parsing those into a typed "step 1 of N" indicator is a v2 polish item.
- **Optimistic updates on rebuild** — currently invalidates. For a future polish pass, optimistically insert a `pending` build into the builds list so the UI updates before the first refetch returns.
- **Pagination on build history** — API supports `limit` up to 100 but no cursor. If teams accumulate many builds, add a "Load more" / cursor pattern later.
- **SDK coverage** — out of scope; tracked separately.

---

## Self-review

**Spec coverage:** Sidebar (Task 9), list page + tabs + search (Tasks 11, 14), detail page + info grid (Task 15), current build panel + logs + cancel (Tasks 17, 18), build history (Tasks 16, 17), create flow + curated images + validation (Task 13), rebuild / delete / launch actions (Tasks 12, 18), API proxy + SSE (Tasks 2, 3), types / query keys / hooks / client (Tasks 1, 4, 5, 8), system-template predicate (Task 6), error humanization (Task 7), launch-from-template wiring (Task 19), verification (Task 20). Every spec requirement maps to at least one task.

**Placeholder scan:** All code blocks contain concrete implementations. Where the executor must consult the existing codebase (e.g. Badge API, TableToolbar API, team-id source), the plan calls that out explicitly with file paths to read — these are not placeholders, they are guidance for adapting to the real surface.

**Type consistency:** `BuildStatus` is used in both the status badge and the build panel; `TemplateStatus` drives detail polling and the badge. `TemplateResponse` / `TemplateBuildResponse` / `CreateTemplateRequest` field names match the OpenAPI spec (snake_case) everywhere. Query keys are used consistently (`templateKeys.list`, `templateKeys.detail`, `templateKeys.builds`, `templateKeys.build`). Hook names are consistent between definitions (Task 8) and usages (Tasks 11 onward).
