# Console API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the console UI to the Superserve backend API using mock Route Handlers, a typed API client, and TanStack Query for data fetching with proper caching, retry, optimistic updates, and error handling.

**Architecture:** Mock Route Handlers implement the OpenAPI spec in-memory. A typed fetch wrapper (`apiClient`) handles auth and error normalization. TanStack Query hooks wire everything together with caching and optimistic updates. When the real backend ships, delete mock routes and change `NEXT_PUBLIC_API_URL`.

**Tech Stack:** Next.js 16, React 19, TanStack Query v5, TypeScript, Biome

**Spec:** `spec/2026-04-04-api-integration-design.md`

---

## File Structure

```
apps/console/src/
├── lib/api/
│   ├── client.ts              # Typed fetch wrapper, ApiError class
│   ├── types.ts               # TypeScript types from OpenAPI schema
│   ├── query-keys.ts          # Query key factories for cache management
│   ├── sandboxes.ts           # Sandbox resource functions
│   ├── api-keys.ts            # API key resource functions
│   ├── exec.ts                # Exec command functions
│   └── files.ts               # File upload/download functions
├── hooks/
│   ├── use-sandboxes.ts       # TanStack Query hooks for sandboxes
│   └── use-api-keys.ts        # TanStack Query hooks for API keys
├── components/
│   ├── query-provider.tsx     # QueryClientProvider wrapper
│   ├── table-skeleton.tsx     # Reusable table skeleton loader
│   └── error-state.tsx        # Reusable error state with retry
├── app/
│   ├── (dashboard)/layout.tsx # Modified: wrap with QueryProvider
│   ├── (dashboard)/sandboxes/page.tsx  # Modified: use hooks
│   ├── (dashboard)/api-keys/page.tsx   # Modified: use hooks
│   ├── (dashboard)/snapshots/page.tsx  # Modified: use hooks
│   ├── (dashboard)/audit-logs/page.tsx # Modified: use hooks
│   ├── (dashboard)/get-started/page.tsx # Modified: use useCreateApiKey
│   └── api/v1/
│       ├── _mock/store.ts              # In-memory mock data store
│       ├── health/route.ts             # GET /health
│       ├── sandboxes/
│       │   ├── route.ts                # GET (list), POST (create)
│       │   └── [sandbox_id]/
│       │       ├── route.ts            # GET (detail), DELETE
│       │       ├── pause/route.ts      # POST
│       │       ├── resume/route.ts     # POST
│       │       ├── exec/
│       │       │   ├── route.ts        # POST (sync exec)
│       │       │   └── stream/route.ts # POST (SSE stream)
│       │       └── files/
│       │           └── [...path]/route.ts  # PUT (upload), GET (download)
│       └── api-keys/
│           ├── route.ts                # GET (list), POST (create)
│           └── [key_id]/route.ts       # DELETE (revoke)
```

---

### Task 1: Install TanStack Query

**Files:**
- Modify: `apps/console/package.json`

- [ ] **Step 1: Install @tanstack/react-query**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bun add @tanstack/react-query --filter @superserve/console
```

- [ ] **Step 2: Verify installation**

```bash
cd /Users/nirnejak/Code/superserve/superserve && grep "@tanstack/react-query" apps/console/package.json
```

Expected: `"@tanstack/react-query": "^5.x.x"` in dependencies.

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/package.json bun.lock && git commit -m "console: add @tanstack/react-query dependency"
```

---

### Task 2: API Types

**Files:**
- Create: `apps/console/src/lib/api/types.ts`

- [ ] **Step 1: Create the types file**

All types derived from the OpenAPI spec components/schemas.

```ts
// apps/console/src/lib/api/types.ts

export type SandboxStatus = "starting" | "active" | "pausing" | "idle" | "deleted"

export interface SandboxResponse {
  id: string
  name: string
  status: SandboxStatus
  vcpu_count: number
  memory_mib: number
  ip_address?: string
  snapshot_id?: string
  created_at: string
}

export interface CreateSandboxRequest {
  name: string
  vcpu_count: number
  memory_mib: number
  from_snapshot?: string
}

export interface ExecRequest {
  command: string
  args?: string[]
  env?: Record<string, string>
  working_dir?: string
  timeout_s?: number
}

export interface ExecResult {
  stdout: string
  stderr: string
  exit_code: number
}

export interface ExecStreamEvent {
  timestamp: string
  stdout?: string
  stderr?: string
  exit_code?: number
  finished?: boolean
  error?: string
}

export interface ApiKeyResponse {
  id: string
  name: string
  prefix: string
  created_at: string
  last_used_at: string | null
}

export interface CreateApiKeyRequest {
  name: string
}

export interface CreateApiKeyResponse {
  id: string
  name: string
  key: string
  prefix: string
  created_at: string
}

export interface ApiError {
  error: {
    code: string
    message: string
  }
}

export interface HealthResponse {
  status: string
  version: string
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/lib/api/types.ts && git commit -m "console: add API types from OpenAPI spec"
```

---

### Task 3: API Client

**Files:**
- Create: `apps/console/src/lib/api/client.ts`
- Modify: `apps/console/src/test/setup.ts`

- [ ] **Step 1: Create the API client**

```ts
// apps/console/src/lib/api/client.ts

const API_KEY_STORAGE_KEY = "superserve-api-key"

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

function getBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL
  if (!url) throw new Error("NEXT_PUBLIC_API_URL is not set")
  return url
}

function getApiKey(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(API_KEY_STORAGE_KEY)
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key)
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY)
}

export async function apiClient<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${getBaseUrl()}${path}`
  const apiKey = getApiKey()

  const headers = new Headers(options.headers)
  if (apiKey) {
    headers.set("X-API-Key", apiKey)
  }
  if (!headers.has("Content-Type") && options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  if (!response.ok) {
    let code = "unknown_error"
    let message = response.statusText

    try {
      const body = await response.json()
      if (body?.error?.code) code = body.error.code
      if (body?.error?.message) message = body.error.message
    } catch {
      // response body is not JSON, use defaults
    }

    throw new ApiError(response.status, code, message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/lib/api/client.ts && git commit -m "console: add typed API client with error handling"
```

---

### Task 4: Query Key Factory

**Files:**
- Create: `apps/console/src/lib/api/query-keys.ts`

- [ ] **Step 1: Create the query key factory**

```ts
// apps/console/src/lib/api/query-keys.ts

export const sandboxKeys = {
  all: ["sandboxes"] as const,
  lists: () => [...sandboxKeys.all, "list"] as const,
  list: (filters: { status?: string; search?: string }) =>
    [...sandboxKeys.lists(), filters] as const,
  details: () => [...sandboxKeys.all, "detail"] as const,
  detail: (id: string) => [...sandboxKeys.details(), id] as const,
}

export const apiKeyKeys = {
  all: ["api-keys"] as const,
  lists: () => [...apiKeyKeys.all, "list"] as const,
  list: (filters?: { search?: string }) =>
    [...apiKeyKeys.lists(), filters] as const,
}

export const snapshotKeys = {
  all: ["snapshots"] as const,
  lists: () => [...snapshotKeys.all, "list"] as const,
  list: (filters?: { search?: string }) =>
    [...snapshotKeys.lists(), filters] as const,
}

export const auditLogKeys = {
  all: ["audit-logs"] as const,
  lists: () => [...auditLogKeys.all, "list"] as const,
  list: (filters?: { action?: string; search?: string }) =>
    [...auditLogKeys.lists(), filters] as const,
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/lib/api/query-keys.ts && git commit -m "console: add query key factories for cache management"
```

---

### Task 5: Sandbox Resource Functions

**Files:**
- Create: `apps/console/src/lib/api/sandboxes.ts`

- [ ] **Step 1: Create the sandbox resource module**

```ts
// apps/console/src/lib/api/sandboxes.ts

import { apiClient } from "./client"
import type { CreateSandboxRequest, SandboxResponse } from "./types"

export async function listSandboxes(): Promise<SandboxResponse[]> {
  return apiClient<SandboxResponse[]>("/v1/sandboxes")
}

export async function getSandbox(id: string): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>(`/v1/sandboxes/${id}`)
}

export async function createSandbox(
  data: CreateSandboxRequest,
): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>("/v1/sandboxes", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function deleteSandbox(id: string): Promise<void> {
  return apiClient<void>(`/v1/sandboxes/${id}`, {
    method: "DELETE",
  })
}

export async function pauseSandbox(id: string): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>(`/v1/sandboxes/${id}/pause`, {
    method: "POST",
  })
}

export async function resumeSandbox(id: string): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>(`/v1/sandboxes/${id}/resume`, {
    method: "POST",
  })
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/lib/api/sandboxes.ts && git commit -m "console: add sandbox API resource functions"
```

---

### Task 6: API Key Resource Functions

**Files:**
- Create: `apps/console/src/lib/api/api-keys.ts`

- [ ] **Step 1: Create the API key resource module**

```ts
// apps/console/src/lib/api/api-keys.ts

import { apiClient } from "./client"
import type {
  ApiKeyResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
} from "./types"

export async function listApiKeys(): Promise<ApiKeyResponse[]> {
  return apiClient<ApiKeyResponse[]>("/v1/api-keys")
}

export async function createApiKey(
  data: CreateApiKeyRequest,
): Promise<CreateApiKeyResponse> {
  return apiClient<CreateApiKeyResponse>("/v1/api-keys", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function revokeApiKey(id: string): Promise<void> {
  return apiClient<void>(`/v1/api-keys/${id}`, {
    method: "DELETE",
  })
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/lib/api/api-keys.ts && git commit -m "console: add API key resource functions"
```

---

### Task 7: Exec & Files Resource Functions

**Files:**
- Create: `apps/console/src/lib/api/exec.ts`
- Create: `apps/console/src/lib/api/files.ts`

- [ ] **Step 1: Create the exec resource module**

```ts
// apps/console/src/lib/api/exec.ts

import { apiClient } from "./client"
import type { ExecRequest, ExecResult } from "./types"

export async function execCommand(
  sandboxId: string,
  data: ExecRequest,
): Promise<ExecResult> {
  return apiClient<ExecResult>(`/v1/sandboxes/${sandboxId}/exec`, {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function execCommandStream(
  sandboxId: string,
  data: ExecRequest,
): { eventSource: EventSource; abort: () => void } {
  const apiKey = localStorage.getItem("superserve-api-key")
  const baseUrl = process.env.NEXT_PUBLIC_API_URL

  // SSE via fetch since EventSource doesn't support POST
  const controller = new AbortController()

  const eventSource = new EventTarget() as EventSource

  fetch(`${baseUrl}/v1/sandboxes/${sandboxId}/exec/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    },
    body: JSON.stringify(data),
    signal: controller.signal,
  }).then(async (response) => {
    const reader = response.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value)
      const lines = text.split("\n")
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6))
          eventSource.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }))
        }
      }
    }
  })

  return {
    eventSource,
    abort: () => controller.abort(),
  }
}
```

- [ ] **Step 2: Create the files resource module**

```ts
// apps/console/src/lib/api/files.ts

import { apiClient } from "./client"

export async function uploadFile(
  sandboxId: string,
  path: string,
  content: Blob | ArrayBuffer,
): Promise<{ path: string; size: number }> {
  const apiKey = localStorage.getItem("superserve-api-key")
  const baseUrl = process.env.NEXT_PUBLIC_API_URL

  const response = await fetch(
    `${baseUrl}/v1/sandboxes/${sandboxId}/files/${path}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
      body: content,
    },
  )

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? response.statusText)
  }

  return response.json()
}

export async function downloadFile(
  sandboxId: string,
  path: string,
): Promise<Blob> {
  const apiKey = localStorage.getItem("superserve-api-key")
  const baseUrl = process.env.NEXT_PUBLIC_API_URL

  const response = await fetch(
    `${baseUrl}/v1/sandboxes/${sandboxId}/files/${path}`,
    {
      headers: {
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
    },
  )

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? response.statusText)
  }

  return response.blob()
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/lib/api/exec.ts apps/console/src/lib/api/files.ts && git commit -m "console: add exec and files API resource functions"
```

---

### Task 8: QueryClient Provider

**Files:**
- Create: `apps/console/src/components/query-provider.tsx`
- Modify: `apps/console/src/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Create the QueryProvider component**

```tsx
// apps/console/src/components/query-provider.tsx

"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { ApiError } from "@/lib/api/client"

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            gcTime: 5 * 60 * 1000,
            retry: (failureCount, error) => {
              if (error instanceof ApiError) {
                // Don't retry auth errors or conflicts
                if (error.status === 401 || error.status === 409) return false
              }
              return failureCount < 3
            },
            refetchOnWindowFocus: true,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
```

- [ ] **Step 2: Wrap the dashboard layout**

Modify `apps/console/src/app/(dashboard)/layout.tsx` to wrap children with `QueryProvider`:

```tsx
// apps/console/src/app/(dashboard)/layout.tsx

import { DashboardShell } from "@/components/layout/dashboard-shell"
import { QueryProvider } from "@/components/query-provider"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <QueryProvider>
      <DashboardShell>{children}</DashboardShell>
    </QueryProvider>
  )
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/components/query-provider.tsx apps/console/src/app/\(dashboard\)/layout.tsx && git commit -m "console: add QueryClientProvider to dashboard layout"
```

---

### Task 9: Shared UI Components (TableSkeleton, ErrorState)

**Files:**
- Create: `apps/console/src/components/table-skeleton.tsx`
- Create: `apps/console/src/components/error-state.tsx`

- [ ] **Step 1: Create the TableSkeleton component**

```tsx
// apps/console/src/components/table-skeleton.tsx

"use client"

import { cn } from "@superserve/ui"

interface TableSkeletonProps {
  columns: number
  rows?: number
}

export function TableSkeleton({ columns, rows = 5 }: TableSkeletonProps) {
  return (
    <div className="flex-1">
      {/* Header skeleton */}
      <div className="flex items-center gap-4 border-b border-border px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <div
            key={`header-${i}`}
            className={cn(
              "h-3 animate-pulse rounded bg-surface-hover",
              i === 0 ? "w-8" : "flex-1",
            )}
          />
        ))}
      </div>
      {/* Row skeletons */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={`row-${rowIndex}`}
          className="flex items-center gap-4 border-b border-border px-4 py-4"
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div
              key={`cell-${rowIndex}-${colIndex}`}
              className={cn(
                "h-3 animate-pulse rounded bg-surface-hover",
                colIndex === 0 ? "w-8" : "flex-1",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create the ErrorState component**

```tsx
// apps/console/src/components/error-state.tsx

"use client"

import { WarningCircleIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import { CornerBrackets } from "./corner-brackets"

interface ErrorStateProps {
  title?: string
  message?: string
  onRetry?: () => void
}

export function ErrorState({
  title = "Something went wrong",
  message = "An error occurred while loading data. Please try again.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="relative flex w-80 flex-col items-center px-10 py-14 text-center">
        <CornerBrackets size="lg" />

        <WarningCircleIcon
          className="size-10 text-destructive/60"
          weight="light"
        />
        <p className="mt-4 text-sm font-medium text-foreground">{title}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted">{message}</p>
        {onRetry && (
          <div className="mt-5">
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try Again
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/components/table-skeleton.tsx apps/console/src/components/error-state.tsx && git commit -m "console: add TableSkeleton and ErrorState shared components"
```

---

### Task 10: Mock Data Store

**Files:**
- Create: `apps/console/src/app/api/v1/_mock/store.ts`

- [ ] **Step 1: Create the in-memory mock store**

```ts
// apps/console/src/app/api/v1/_mock/store.ts

import type {
  ApiKeyResponse,
  SandboxResponse,
} from "@/lib/api/types"

// --- Sandboxes ---

const now = new Date()

function hoursAgo(h: number): string {
  return new Date(now.getTime() - h * 60 * 60 * 1000).toISOString()
}

function daysAgo(d: number): string {
  return new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString()
}

export const sandboxes: SandboxResponse[] = [
  {
    id: "a1b2c3d4-1111-4000-8000-000000000001",
    name: "dev-agent-sandbox",
    status: "active",
    vcpu_count: 1,
    memory_mib: 1024,
    ip_address: "10.0.1.12",
    created_at: daysAgo(3),
  },
  {
    id: "a1b2c3d4-2222-4000-8000-000000000002",
    name: "staging-sandbox",
    status: "idle",
    vcpu_count: 2,
    memory_mib: 2048,
    snapshot_id: "snap-0001-0001-0001-000000000001",
    created_at: daysAgo(7),
  },
  {
    id: "a1b2c3d4-3333-4000-8000-000000000003",
    name: "test-runner",
    status: "active",
    vcpu_count: 1,
    memory_mib: 1024,
    ip_address: "10.0.1.15",
    created_at: daysAgo(1),
  },
  {
    id: "a1b2c3d4-4444-4000-8000-000000000004",
    name: "ci-build-env",
    status: "idle",
    vcpu_count: 4,
    memory_mib: 4096,
    snapshot_id: "snap-0002-0002-0002-000000000002",
    created_at: daysAgo(14),
  },
  {
    id: "a1b2c3d4-5555-4000-8000-000000000005",
    name: "demo-sandbox",
    status: "starting",
    vcpu_count: 1,
    memory_mib: 1024,
    created_at: hoursAgo(0.1),
  },
]

// --- API Keys ---

export const apiKeys: (ApiKeyResponse & { full_key?: string })[] = [
  {
    id: "key-0001",
    name: "Production",
    prefix: "ss_live_a1b2c3d4...",
    full_key: "ss_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4",
    created_at: daysAgo(30),
    last_used_at: hoursAgo(2),
  },
  {
    id: "key-0002",
    name: "Development",
    prefix: "ss_live_q7r8s9t0...",
    full_key: "ss_live_q7r8s9t0u1v2w3x4y5z6a7b8c9d0",
    created_at: daysAgo(14),
    last_used_at: daysAgo(1),
  },
  {
    id: "key-0003",
    name: "CI/CD Pipeline",
    prefix: "ss_live_g3h4i5j6...",
    full_key: "ss_live_g3h4i5j6k7l8m9n0o1p2q3r4s5t6",
    created_at: daysAgo(7),
    last_used_at: null,
  },
]

// --- Audit Logs ---

export interface AuditLogEntry {
  id: string
  time: string
  user: string
  action: string
  target: string
  outcome: "Success" | "Failure"
}

export const auditLogs: AuditLogEntry[] = [
  {
    id: "log-001",
    time: hoursAgo(1),
    user: "user@example.com",
    action: "Create",
    target: "sandbox / dev-agent-sandbox",
    outcome: "Success",
  },
  {
    id: "log-002",
    time: hoursAgo(2),
    user: "user@example.com",
    action: "Start",
    target: "sandbox / test-runner",
    outcome: "Success",
  },
  {
    id: "log-003",
    time: hoursAgo(5),
    user: "user@example.com",
    action: "Update",
    target: "api_key / Production",
    outcome: "Success",
  },
  {
    id: "log-004",
    time: daysAgo(1),
    user: "user@example.com",
    action: "Create",
    target: "api_key / Development",
    outcome: "Success",
  },
  {
    id: "log-005",
    time: daysAgo(3),
    user: "user@example.com",
    action: "Pause",
    target: "sandbox / staging-sandbox",
    outcome: "Success",
  },
  {
    id: "log-006",
    time: daysAgo(5),
    user: "user@example.com",
    action: "Start",
    target: "sandbox / ci-build-env",
    outcome: "Failure",
  },
  {
    id: "log-007",
    time: daysAgo(7),
    user: "user@example.com",
    action: "Create",
    target: "sandbox / ci-build-env",
    outcome: "Success",
  },
  {
    id: "log-008",
    time: daysAgo(10),
    user: "user@example.com",
    action: "Create",
    target: "api_key / CI/CD Pipeline",
    outcome: "Success",
  },
]

// --- Snapshots (derived from paused sandboxes) ---

export interface SnapshotEntry {
  id: string
  name: string
  created_at: string
  last_used_at: string | null
}

export const snapshots: SnapshotEntry[] = [
  {
    id: "snap-0001-0001-0001-000000000001",
    name: "staging-sandbox-snapshot",
    created_at: daysAgo(5),
    last_used_at: daysAgo(2),
  },
  {
    id: "snap-0002-0002-0002-000000000002",
    name: "ci-build-env-snapshot",
    created_at: daysAgo(10),
    last_used_at: null,
  },
  {
    id: "snap-0003-0003-0003-000000000003",
    name: "demo-checkpoint",
    created_at: daysAgo(1),
    last_used_at: null,
  },
]
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/app/api/v1/_mock/store.ts && git commit -m "console: add in-memory mock data store"
```

---

### Task 11: Mock Route — Health

**Files:**
- Create: `apps/console/src/app/api/v1/health/route.ts`

- [ ] **Step 1: Create the health route**

```ts
// apps/console/src/app/api/v1/health/route.ts

import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({ status: "ok", version: "0.1.0" })
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/app/api/v1/health/route.ts && git commit -m "console: add mock health endpoint"
```

---

### Task 12: Mock Routes — Sandboxes

**Files:**
- Create: `apps/console/src/app/api/v1/sandboxes/route.ts`
- Create: `apps/console/src/app/api/v1/sandboxes/[sandbox_id]/route.ts`
- Create: `apps/console/src/app/api/v1/sandboxes/[sandbox_id]/pause/route.ts`
- Create: `apps/console/src/app/api/v1/sandboxes/[sandbox_id]/resume/route.ts`

- [ ] **Step 1: Create the list/create route**

```ts
// apps/console/src/app/api/v1/sandboxes/route.ts

import { NextResponse } from "next/server"
import { sandboxes } from "../_mock/store"

export async function GET(request: Request) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  return NextResponse.json(sandboxes.filter((s) => s.status !== "deleted"))
}

export async function POST(request: Request) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  const body = await request.json()
  const { name, vcpu_count, memory_mib } = body

  if (!name || !vcpu_count || !memory_mib) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Missing required fields: name, vcpu_count, memory_mib" } },
      { status: 400 },
    )
  }

  const id = crypto.randomUUID()
  const sandbox = {
    id,
    name,
    status: "starting" as const,
    vcpu_count,
    memory_mib,
    created_at: new Date().toISOString(),
  }

  sandboxes.push(sandbox)

  // Simulate VM boot: flip to active after 3 seconds
  setTimeout(() => {
    const entry = sandboxes.find((s) => s.id === id)
    if (entry && entry.status === "starting") {
      entry.status = "active"
      entry.ip_address = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
    }
  }, 3000)

  return NextResponse.json(sandbox, { status: 201 })
}
```

- [ ] **Step 2: Create the detail/delete route**

```ts
// apps/console/src/app/api/v1/sandboxes/[sandbox_id]/route.ts

import { NextResponse } from "next/server"
import { sandboxes } from "../../_mock/store"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sandbox_id: string }> },
) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  const { sandbox_id } = await params
  const sandbox = sandboxes.find(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (!sandbox) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  return NextResponse.json(sandbox)
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ sandbox_id: string }> },
) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  const { sandbox_id } = await params
  const index = sandboxes.findIndex(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (index === -1) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  sandboxes[index].status = "deleted"

  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 3: Create the pause route**

```ts
// apps/console/src/app/api/v1/sandboxes/[sandbox_id]/pause/route.ts

import { NextResponse } from "next/server"
import { sandboxes } from "../../../_mock/store"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sandbox_id: string }> },
) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  const { sandbox_id } = await params
  const sandbox = sandboxes.find(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (!sandbox) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  if (sandbox.status !== "active") {
    return NextResponse.json(
      { error: { code: "conflict", message: "Sandbox must be active to pause" } },
      { status: 409 },
    )
  }

  sandbox.status = "idle"
  sandbox.snapshot_id = crypto.randomUUID()
  delete (sandbox as Record<string, unknown>).ip_address

  return NextResponse.json(sandbox)
}
```

- [ ] **Step 4: Create the resume route**

```ts
// apps/console/src/app/api/v1/sandboxes/[sandbox_id]/resume/route.ts

import { NextResponse } from "next/server"
import { sandboxes } from "../../../_mock/store"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sandbox_id: string }> },
) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  const { sandbox_id } = await params
  const sandbox = sandboxes.find(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (!sandbox) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  if (sandbox.status !== "idle") {
    return NextResponse.json(
      { error: { code: "conflict", message: "Sandbox must be idle to resume" } },
      { status: 409 },
    )
  }

  sandbox.status = "active"
  sandbox.ip_address = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`

  return NextResponse.json(sandbox)
}
```

- [ ] **Step 5: Run dev server and verify**

```bash
cd /Users/nirnejak/Code/superserve/superserve && curl -s -H "X-API-Key: test" http://localhost:3001/api/v1/sandboxes | head -c 200
```

Expected: JSON array of sandboxes.

- [ ] **Step 6: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/app/api/v1/sandboxes/ && git commit -m "console: add mock sandbox CRUD routes"
```

---

### Task 13: Mock Routes — API Keys

**Files:**
- Create: `apps/console/src/app/api/v1/api-keys/route.ts`
- Create: `apps/console/src/app/api/v1/api-keys/[key_id]/route.ts`

- [ ] **Step 1: Create the list/create route**

```ts
// apps/console/src/app/api/v1/api-keys/route.ts

import { NextResponse } from "next/server"
import { apiKeys } from "../_mock/store"

export async function GET(request: Request) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  // Return keys without full_key field
  const keys = apiKeys.map(({ full_key: _, ...rest }) => rest)
  return NextResponse.json(keys)
}

export async function POST(request: Request) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  const body = await request.json()
  const { name } = body

  if (!name) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Missing required field: name" } },
      { status: 400 },
    )
  }

  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let keyStr = ""
  for (let i = 0; i < 32; i++) {
    keyStr += chars[Math.floor(Math.random() * chars.length)]
  }

  const fullKey = `ss_live_${keyStr}`
  const prefix = `ss_live_${keyStr.slice(0, 8)}...`
  const id = crypto.randomUUID()

  const newKey = {
    id,
    name,
    prefix,
    full_key: fullKey,
    created_at: new Date().toISOString(),
    last_used_at: null,
  }

  apiKeys.push(newKey)

  // Return with full key visible (only time it's shown)
  return NextResponse.json(
    {
      id,
      name,
      key: fullKey,
      prefix,
      created_at: newKey.created_at,
    },
    { status: 201 },
  )
}
```

- [ ] **Step 2: Create the revoke route**

```ts
// apps/console/src/app/api/v1/api-keys/[key_id]/route.ts

import { NextResponse } from "next/server"
import { apiKeys } from "../../_mock/store"

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key_id: string }> },
) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  const { key_id } = await params
  const index = apiKeys.findIndex((k) => k.id === key_id)

  if (index === -1) {
    return NextResponse.json(
      { error: { code: "not_found", message: "API key not found" } },
      { status: 404 },
    )
  }

  apiKeys.splice(index, 1)

  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/app/api/v1/api-keys/ && git commit -m "console: add mock API key routes"
```

---

### Task 14: Mock Routes — Snapshots & Audit Logs

**Files:**
- Create: `apps/console/src/app/api/v1/snapshots/route.ts`
- Create: `apps/console/src/app/api/v1/audit-logs/route.ts`

- [ ] **Step 1: Create the snapshots route**

```ts
// apps/console/src/app/api/v1/snapshots/route.ts

import { NextResponse } from "next/server"
import { snapshots } from "../_mock/store"

export async function GET(request: Request) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  return NextResponse.json(snapshots)
}
```

- [ ] **Step 2: Create the audit logs route**

```ts
// apps/console/src/app/api/v1/audit-logs/route.ts

import { NextResponse } from "next/server"
import { auditLogs } from "../_mock/store"

export async function GET(request: Request) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  return NextResponse.json(auditLogs)
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/app/api/v1/snapshots/ apps/console/src/app/api/v1/audit-logs/ && git commit -m "console: add mock snapshots and audit logs routes"
```

---

### Task 15: Mock Routes — Exec & Files

**Files:**
- Create: `apps/console/src/app/api/v1/sandboxes/[sandbox_id]/exec/route.ts`
- Create: `apps/console/src/app/api/v1/sandboxes/[sandbox_id]/exec/stream/route.ts`
- Create: `apps/console/src/app/api/v1/sandboxes/[sandbox_id]/files/[...path]/route.ts`

- [ ] **Step 1: Create the exec route**

```ts
// apps/console/src/app/api/v1/sandboxes/[sandbox_id]/exec/route.ts

import { NextResponse } from "next/server"
import { sandboxes } from "../../../_mock/store"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sandbox_id: string }> },
) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  const { sandbox_id } = await params
  const sandbox = sandboxes.find(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (!sandbox) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  if (sandbox.status !== "active" && sandbox.status !== "idle") {
    return NextResponse.json(
      { error: { code: "conflict", message: "Sandbox is not in a runnable state" } },
      { status: 409 },
    )
  }

  const body = await request.json()
  const { command } = body

  // Simulate command execution delay
  await new Promise((resolve) => setTimeout(resolve, 500))

  return NextResponse.json({
    stdout: `$ ${command}\nHello from sandbox ${sandbox.name}!\n`,
    stderr: "",
    exit_code: 0,
  })
}
```

- [ ] **Step 2: Create the exec stream route**

```ts
// apps/console/src/app/api/v1/sandboxes/[sandbox_id]/exec/stream/route.ts

import { NextResponse } from "next/server"
import { sandboxes } from "../../../../_mock/store"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sandbox_id: string }> },
) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  const { sandbox_id } = await params
  const sandbox = sandboxes.find(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (!sandbox) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  const body = await request.json()
  const { command } = body

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const chunks = [
        { stdout: `$ ${command}\n` },
        { stdout: "Running command...\n" },
        { stdout: `Hello from sandbox ${sandbox.name}!\n` },
        { stdout: "Done.\n", exit_code: 0, finished: true },
      ]

      for (const chunk of chunks) {
        const event = {
          timestamp: new Date().toISOString(),
          ...chunk,
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        )
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
```

- [ ] **Step 3: Create the files route**

```ts
// apps/console/src/app/api/v1/sandboxes/[sandbox_id]/files/[...path]/route.ts

import { NextResponse } from "next/server"
import { sandboxes } from "../../../../_mock/store"

// Simple in-memory file store
const fileStore = new Map<string, ArrayBuffer>()

function getStoreKey(sandboxId: string, path: string): string {
  return `${sandboxId}:${path}`
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sandbox_id: string; path: string[] }> },
) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  const { sandbox_id, path } = await params
  const sandbox = sandboxes.find(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (!sandbox) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  const filePath = path.join("/")
  const buffer = await request.arrayBuffer()
  fileStore.set(getStoreKey(sandbox_id, filePath), buffer)

  return NextResponse.json({ path: filePath, size: buffer.byteLength })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sandbox_id: string; path: string[] }> },
) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key" } },
      { status: 401 },
    )
  }

  const { sandbox_id, path } = await params
  const sandbox = sandboxes.find(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (!sandbox) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  const filePath = path.join("/")
  const buffer = fileStore.get(getStoreKey(sandbox_id, filePath))

  if (!buffer) {
    return NextResponse.json(
      { error: { code: "not_found", message: "File not found" } },
      { status: 404 },
    )
  }

  return new Response(buffer, {
    headers: { "Content-Type": "application/octet-stream" },
  })
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/app/api/v1/sandboxes/\[sandbox_id\]/exec/ apps/console/src/app/api/v1/sandboxes/\[sandbox_id\]/files/ && git commit -m "console: add mock exec and files routes"
```

---

### Task 16: TanStack Query Hooks — Sandboxes

**Files:**
- Create: `apps/console/src/hooks/use-sandboxes.ts`

- [ ] **Step 1: Create the sandbox hooks**

```tsx
// apps/console/src/hooks/use-sandboxes.ts

"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@superserve/ui"
import {
  createSandbox,
  deleteSandbox,
  getSandbox,
  listSandboxes,
  pauseSandbox,
  resumeSandbox,
} from "@/lib/api/sandboxes"
import { sandboxKeys } from "@/lib/api/query-keys"
import type { CreateSandboxRequest, SandboxResponse } from "@/lib/api/types"
import { ApiError } from "@/lib/api/client"

export function useSandboxes() {
  return useQuery({
    queryKey: sandboxKeys.all,
    queryFn: listSandboxes,
  })
}

export function useSandbox(id: string | null) {
  return useQuery({
    queryKey: sandboxKeys.detail(id!),
    queryFn: () => getSandbox(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "starting" || status === "pausing" ? 2000 : false
    },
  })
}

export function useCreateSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (data: CreateSandboxRequest) => createSandbox(data),
    onSuccess: (newSandbox) => {
      queryClient.setQueryData<SandboxResponse[]>(sandboxKeys.all, (old) =>
        old ? [newSandbox, ...old] : [newSandbox],
      )
      addToast(`Sandbox "${newSandbox.name}" is starting`, "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Failed to create sandbox"
      addToast(message, "error")
    },
  })
}

export function useDeleteSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => deleteSandbox(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: sandboxKeys.all })
      const previous = queryClient.getQueryData<SandboxResponse[]>(
        sandboxKeys.all,
      )
      queryClient.setQueryData<SandboxResponse[]>(sandboxKeys.all, (old) =>
        old?.filter((s) => s.id !== id),
      )
      return { previous }
    },
    onError: (error, _id, context) => {
      queryClient.setQueryData(sandboxKeys.all, context?.previous)
      const message =
        error instanceof ApiError ? error.message : "Failed to delete sandbox"
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}

export function useBulkDeleteSandboxes() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteSandbox(id)))
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: sandboxKeys.all })
      const previous = queryClient.getQueryData<SandboxResponse[]>(
        sandboxKeys.all,
      )
      const idSet = new Set(ids)
      queryClient.setQueryData<SandboxResponse[]>(sandboxKeys.all, (old) =>
        old?.filter((s) => !idSet.has(s.id)),
      )
      return { previous }
    },
    onError: (error, _ids, context) => {
      queryClient.setQueryData(sandboxKeys.all, context?.previous)
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to delete sandboxes"
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}

export function usePauseSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => pauseSandbox(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: sandboxKeys.all })
      const previous = queryClient.getQueryData<SandboxResponse[]>(
        sandboxKeys.all,
      )
      queryClient.setQueryData<SandboxResponse[]>(sandboxKeys.all, (old) =>
        old?.map((s) => (s.id === id ? { ...s, status: "idle" as const } : s)),
      )
      return { previous }
    },
    onError: (error, _id, context) => {
      queryClient.setQueryData(sandboxKeys.all, context?.previous)
      const message =
        error instanceof ApiError ? error.message : "Failed to pause sandbox"
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}

export function useResumeSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => resumeSandbox(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: sandboxKeys.all })
      const previous = queryClient.getQueryData<SandboxResponse[]>(
        sandboxKeys.all,
      )
      queryClient.setQueryData<SandboxResponse[]>(sandboxKeys.all, (old) =>
        old?.map((s) =>
          s.id === id ? { ...s, status: "active" as const } : s,
        ),
      )
      return { previous }
    },
    onError: (error, _id, context) => {
      queryClient.setQueryData(sandboxKeys.all, context?.previous)
      const message =
        error instanceof ApiError ? error.message : "Failed to resume sandbox"
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/hooks/use-sandboxes.ts && git commit -m "console: add TanStack Query hooks for sandboxes"
```

---

### Task 17: TanStack Query Hooks — API Keys

**Files:**
- Create: `apps/console/src/hooks/use-api-keys.ts`

- [ ] **Step 1: Create the API key hooks**

```tsx
// apps/console/src/hooks/use-api-keys.ts

"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@superserve/ui"
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "@/lib/api/api-keys"
import { apiKeyKeys } from "@/lib/api/query-keys"
import type { ApiKeyResponse, CreateApiKeyResponse } from "@/lib/api/types"
import { ApiError, setApiKey } from "@/lib/api/client"

export function useApiKeys() {
  return useQuery({
    queryKey: apiKeyKeys.all,
    queryFn: listApiKeys,
  })
}

export function useCreateApiKey() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (name: string) => createApiKey({ name }),
    onSuccess: (created: CreateApiKeyResponse) => {
      // Store the key for API authentication
      setApiKey(created.key)

      // Add to list cache (without the full key)
      const listEntry: ApiKeyResponse = {
        id: created.id,
        name: created.name,
        prefix: created.prefix,
        created_at: created.created_at,
        last_used_at: null,
      }
      queryClient.setQueryData<ApiKeyResponse[]>(apiKeyKeys.all, (old) =>
        old ? [listEntry, ...old] : [listEntry],
      )
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Failed to create API key"
      addToast(message, "error")
    },
  })
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: apiKeyKeys.all })
      const previous = queryClient.getQueryData<ApiKeyResponse[]>(
        apiKeyKeys.all,
      )
      queryClient.setQueryData<ApiKeyResponse[]>(apiKeyKeys.all, (old) =>
        old?.filter((k) => k.id !== id),
      )
      return { previous }
    },
    onError: (error, _id, context) => {
      queryClient.setQueryData(apiKeyKeys.all, context?.previous)
      const message =
        error instanceof ApiError ? error.message : "Failed to revoke API key"
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all })
    },
  })
}

export function useBulkRevokeApiKeys() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => revokeApiKey(id)))
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: apiKeyKeys.all })
      const previous = queryClient.getQueryData<ApiKeyResponse[]>(
        apiKeyKeys.all,
      )
      const idSet = new Set(ids)
      queryClient.setQueryData<ApiKeyResponse[]>(apiKeyKeys.all, (old) =>
        old?.filter((k) => !idSet.has(k.id)),
      )
      return { previous }
    },
    onError: (error, _ids, context) => {
      queryClient.setQueryData(apiKeyKeys.all, context?.previous)
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to revoke API keys"
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all })
    },
  })
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/hooks/use-api-keys.ts && git commit -m "console: add TanStack Query hooks for API keys"
```

---

### Task 18: Wire Up Sandboxes Page

**Files:**
- Modify: `apps/console/src/app/(dashboard)/sandboxes/page.tsx`
- Modify: `apps/console/src/components/sandboxes/create-sandbox-dialog.tsx`

- [ ] **Step 1: Update the sandboxes page**

Replace the entire `apps/console/src/app/(dashboard)/sandboxes/page.tsx` with a version that uses the TanStack Query hooks instead of mock data. Key changes:

- Remove `MOCK_SANDBOXES` constant and `useState` for sandboxes
- Import and use `useSandboxes`, `useDeleteSandbox`, `useBulkDeleteSandboxes`, `usePauseSandbox`, `useResumeSandbox`
- Map API `SandboxStatus` to badge variants (`active` → `success`, `idle` → `muted`, `starting`/`pausing` → `warning`, `deleted` → `destructive`)
- Update `STATUS_TABS` to match API statuses: All, Active, Idle, Starting
- Add `isPending` → `<TableSkeleton columns={6} />` state
- Add `error` → `<ErrorState onRetry={refetch} />` state
- Wire up Start/Stop button to call `useResumeSandbox`/`usePauseSandbox`
- Wire up Delete dropdown item to call `useDeleteSandbox`
- Wire up bulk delete to call `useBulkDeleteSandboxes`
- Display `vcpu_count` and `memory_mib` in the resources column as `{vcpu_count}CPU | {memory_mib}MB`
- Display `snapshot_id` in the snapshot column (or "-" if none)
- Keep PostHog tracking with `posthog.capture()` in mutation `onSuccess` callbacks

```tsx
// apps/console/src/app/(dashboard)/sandboxes/page.tsx

"use client"

import {
  CubeIcon,
  DotsThreeVerticalIcon,
  KeyIcon,
  KeyReturnIcon,
  PlayIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Badge,
  type BadgeVariant,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { CreateSandboxDialog } from "@/components/sandboxes/create-sandbox-dialog"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { useSelection } from "@/hooks/use-selection"
import {
  useSandboxes,
  useDeleteSandbox,
  useBulkDeleteSandboxes,
  usePauseSandbox,
  useResumeSandbox,
} from "@/hooks/use-sandboxes"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"
import type { SandboxStatus } from "@/lib/api/types"

const STATUS_BADGE_VARIANT: Record<SandboxStatus, BadgeVariant> = {
  active: "success",
  starting: "warning",
  pausing: "warning",
  idle: "muted",
  deleted: "destructive",
}

const STATUS_LABELS: Record<SandboxStatus, string> = {
  active: "Active",
  starting: "Starting",
  pausing: "Pausing",
  idle: "Idle",
  deleted: "Deleted",
}

const STATUS_TABS = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Idle", value: "idle" },
  { label: "Starting", value: "starting" },
]

export default function SandboxesPage() {
  const posthog = usePostHog()
  const { data: sandboxes, isPending, error, refetch } = useSandboxes()
  const deleteSandbox = useDeleteSandbox()
  const bulkDelete = useBulkDeleteSandboxes()
  const pauseMutation = usePauseSandbox()
  const resumeMutation = useResumeSandbox()

  const [statusFilter, setStatusFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)

  const filtered = useMemo(() => {
    if (!sandboxes) return []
    return sandboxes.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false
      if (search && !s.name.toLowerCase().includes(search.toLowerCase()))
        return false
      return true
    })
  }, [sandboxes, statusFilter, search])

  const tabs = STATUS_TABS.map((tab) => ({
    ...tab,
    count:
      tab.value === "all"
        ? (sandboxes?.length ?? 0)
        : (sandboxes?.filter((s) => s.status === tab.value).length ?? 0),
  }))

  const {
    selected,
    allSelected,
    someSelected,
    toggleAll,
    toggleOne,
    clearSelection,
  } = useSelection(filtered)

  const deleteSelected = () => {
    const ids = Array.from(selected)
    posthog.capture(SANDBOX_EVENTS.BULK_DELETED, { count: ids.length })
    bulkDelete.mutate(ids)
    clearSelection()
  }

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Sandboxes" />
        <TableSkeleton columns={6} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Sandboxes" />
        <ErrorState
          message={error.message}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  const isEmpty = !sandboxes || sandboxes.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Sandboxes">
        {!isEmpty && (
          <CreateSandboxDialog open={createOpen} onOpenChange={setCreateOpen} />
        )}
      </PageHeader>

      {isEmpty ? (
        <>
          <EmptyState
            icon={CubeIcon}
            title="No Sandboxes"
            description="Create your first sandbox to start deploying agents."
            actionLabel="Create Sandbox"
            onAction={() => setCreateOpen(true)}
          />
          <CreateSandboxDialog open={createOpen} onOpenChange={setCreateOpen} />
        </>
      ) : (
        <>
          <TableToolbar
            tabs={tabs}
            activeTab={statusFilter}
            onTabChange={setStatusFilter}
            searchPlaceholder="Search sandboxes..."
            searchValue={search}
            onSearchChange={setSearch}
            selectedCount={selected.size}
            onClearSelection={clearSelection}
            onDeleteSelected={deleteSelected}
          />

          <div className="flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <Checkbox
                      checked={someSelected ? "indeterminate" : allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all sandboxes"
                    />
                  </TableHead>
                  <TableHead className="w-[30%]">Name</TableHead>
                  <TableHead className="w-[15%]">Status</TableHead>
                  <TableHead className="w-[20%]">Snapshot</TableHead>
                  <TableHead className="w-[15%]">Resources</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <StickyHoverTableBody>
                {filtered.map((sandbox) => (
                  <TableRow key={sandbox.id}>
                    <TableCell className="pr-0">
                      <Checkbox
                        checked={selected.has(sandbox.id)}
                        onCheckedChange={() => toggleOne(sandbox.id)}
                        aria-label={`Select ${sandbox.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-foreground/80">
                      {sandbox.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE_VARIANT[sandbox.status]} dot>
                        {STATUS_LABELS[sandbox.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {sandbox.snapshot_id
                        ? `${sandbox.snapshot_id.slice(0, 8)}...`
                        : "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted">
                      {sandbox.vcpu_count}CPU | {sandbox.memory_mib}MB
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-20 text-xs"
                          disabled={
                            sandbox.status === "starting" ||
                            sandbox.status === "pausing"
                          }
                          onClick={() => {
                            if (sandbox.status === "active") {
                              posthog.capture(SANDBOX_EVENTS.STOPPED)
                              pauseMutation.mutate(sandbox.id)
                            } else if (sandbox.status === "idle") {
                              posthog.capture(SANDBOX_EVENTS.STARTED)
                              resumeMutation.mutate(sandbox.id)
                            }
                          }}
                        >
                          {sandbox.status === "active" ? (
                            <>
                              <StopIcon className="size-3" weight="light" />
                              Stop
                            </>
                          ) : (
                            <>
                              <PlayIcon className="size-3" weight="light" />
                              Start
                            </>
                          )}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Sandbox actions"
                            >
                              <DotsThreeVerticalIcon
                                className="size-4"
                                weight="bold"
                              />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                              <TerminalIcon className="size-4" weight="light" />
                              Open Terminal
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <KeyIcon className="size-4" weight="light" />
                              Create SSH Access
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <KeyReturnIcon
                                className="size-4"
                                weight="light"
                              />
                              Remove SSH Access
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                posthog.capture(SANDBOX_EVENTS.DELETED)
                                deleteSandbox.mutate(sandbox.id)
                              }}
                            >
                              <TrashIcon className="size-4" weight="light" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </StickyHoverTableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update the CreateSandboxDialog to call the mutation**

Modify `apps/console/src/components/sandboxes/create-sandbox-dialog.tsx`:

- Import `useCreateSandbox` from `@/hooks/use-sandboxes`
- Add `vcpuCount` and `memoryMib` state (default 1 and 1024)
- Wire the "Create Sandbox" button to call `createMutation.mutate({ name, vcpu_count: vcpuCount, memory_mib: memoryMib })`
- Close dialog on success
- Disable button while `createMutation.isPending`

```tsx
// apps/console/src/components/sandboxes/create-sandbox-dialog.tsx

"use client"

import { PlusIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useRef, useState } from "react"
import { useCreateSandbox } from "@/hooks/use-sandboxes"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"

interface EnvVar {
  id: string
  key: string
  value: string
}

function createEnvVar(key = "", value = ""): EnvVar {
  return { id: crypto.randomUUID(), key, value }
}

interface CreateSandboxDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CreateSandboxDialog({
  open: controlledOpen,
  onOpenChange,
}: CreateSandboxDialogProps = {}) {
  const posthog = usePostHog()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [name, setName] = useState("")
  const [envVars, setEnvVars] = useState<EnvVar[]>([createEnvVar()])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const createMutation = useCreateSandbox()

  const addEnvVar = () => {
    setEnvVars([...envVars, createEnvVar()])
  }

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index))
  }

  const updateEnvVar = (index: number, field: "key" | "value", val: string) => {
    setEnvVars(
      envVars.map((v, i) => (i === index ? { ...v, [field]: val } : v)),
    )
  }

  const handleImportEnv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      const lines = text.split("\n").filter((line) => {
        const trimmed = line.trim()
        return trimmed && !trimmed.startsWith("#")
      })

      const parsed: EnvVar[] = lines.map((line) => {
        const eqIndex = line.indexOf("=")
        if (eqIndex === -1) return createEnvVar(line.trim())
        return createEnvVar(
          line.slice(0, eqIndex).trim(),
          line
            .slice(eqIndex + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        )
      })

      if (parsed.length > 0) {
        setEnvVars(parsed)
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const handleReset = () => {
    setName("")
    setEnvVars([createEnvVar()])
  }

  const handleCreate = () => {
    if (!name.trim()) return
    posthog.capture(SANDBOX_EVENTS.CREATED, { name: name.trim() })
    createMutation.mutate(
      { name: name.trim(), vcpu_count: 1, memory_mib: 1024 },
      {
        onSuccess: () => {
          setOpen(false)
          handleReset()
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) handleReset()
      }}
    >
      <DialogTrigger asChild>
        <Button>Create Sandbox</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Sandbox</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto p-6 pt-2">
          <FormField label="Sandbox Name" required>
            <Input
              placeholder="my-sandbox"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          <FormField label="Snapshot" description="More snapshots coming soon">
            <Select defaultValue="base">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="base">superserve/base</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="block text-sm font-medium text-foreground">
                Environment Variables
              </span>
              <div className="flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleImportEnv}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadSimpleIcon className="size-3.5" weight="light" />
                  Import .env
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {envVars.map((envVar, index) => (
                <div key={envVar.id} className="flex items-center gap-2">
                  <Input
                    placeholder="KEY"
                    value={envVar.key}
                    onChange={(e) => updateEnvVar(index, "key", e.target.value)}
                    className="flex-1 font-mono text-xs"
                  />
                  <Input
                    placeholder="value"
                    value={envVar.value}
                    onChange={(e) =>
                      updateEnvVar(index, "value", e.target.value)
                    }
                    className="flex-1 font-mono text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeEnvVar(index)}
                    disabled={envVars.length === 1}
                    aria-label="Remove variable"
                    className="text-muted hover:text-destructive"
                  >
                    <TrashIcon className="size-3.5" weight="light" />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={addEnvVar}
            >
              <PlusIcon className="size-3.5" weight="light" />
              Add variable
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating..." : "Create Sandbox"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/app/\(dashboard\)/sandboxes/page.tsx apps/console/src/components/sandboxes/create-sandbox-dialog.tsx && git commit -m "console: wire sandboxes page to API with TanStack Query"
```

---

### Task 19: Wire Up API Keys Page

**Files:**
- Modify: `apps/console/src/app/(dashboard)/api-keys/page.tsx`

- [ ] **Step 1: Update the API keys page**

Replace the entire file. Key changes:

- Remove `INITIAL_KEYS`, `generateMockKey()`, inline `useState` for keys
- Import and use `useApiKeys`, `useCreateApiKey`, `useRevokeApiKey`, `useBulkRevokeApiKeys`
- Update `CreateKeyDialog` to use `useCreateApiKey` mutation
- Add `isPending` → `<TableSkeleton columns={6} />`
- Add `error` → `<ErrorState />`
- Map `ApiKeyResponse` fields: `created_at` → `formatDate(new Date(key.created_at))`, `last_used_at` similarly

```tsx
// apps/console/src/app/(dashboard)/api-keys/page.tsx

"use client"

import {
  CopyIcon,
  DotsThreeVerticalIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FormField,
  Input,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { useSelection } from "@/hooks/use-selection"
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useBulkRevokeApiKeys,
} from "@/hooks/use-api-keys"
import { formatDate } from "@/lib/format"
import { API_KEY_EVENTS } from "@/lib/posthog/events"

function maskKey(prefix: string): string {
  return `${prefix.replace("...", "")}${"•".repeat(20)}`
}

function CreateKeyDialog({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [name, setName] = useState("")
  const [createdKey, setCreatedKey] = useState<{
    full: string
  } | null>(null)
  const [copied, setCopied] = useState(false)
  const { addToast } = useToast()
  const posthog = usePostHog()
  const createMutation = useCreateApiKey()

  const handleCreate = () => {
    if (!name.trim()) return
    posthog.capture(API_KEY_EVENTS.CREATED, { name: name.trim() })
    createMutation.mutate(name.trim(), {
      onSuccess: (data) => {
        setCreatedKey({ full: data.key })
      },
    })
  }

  const handleCopy = async () => {
    if (!createdKey) return
    await navigator.clipboard.writeText(createdKey.full)
    posthog.capture(API_KEY_EVENTS.COPIED)
    setCopied(true)
    addToast("API key copied to clipboard", "success")
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    setOpen(false)
    setName("")
    setCreatedKey(null)
    setCopied(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => (v ? setOpen(true) : handleClose())}
    >
      <DialogTrigger asChild>
        <Button>
          <PlusIcon className="size-3.5" weight="light" />
          Create Key
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {createdKey ? "API Key Created" : "Create API Key"}
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 pt-2">
          {createdKey ? (
            <div className="space-y-4">
              <Alert variant="warning">
                Copy this key now. You won&apos;t be able to see it again.
              </Alert>

              <FormField label="Your API Key">
                <div className="flex items-center gap-2">
                  <code className="flex-1 border border-border bg-background px-3 py-2 font-mono text-xs text-foreground break-all">
                    {createdKey.full}
                  </code>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={handleCopy}
                    aria-label={copied ? "Copied" : "Copy API key"}
                  >
                    <CopyIcon
                      className="size-3.5"
                      weight={copied ? "fill" : "light"}
                    />
                  </Button>
                </div>
              </FormField>
            </div>
          ) : (
            <FormField label="Key Name" required>
              <Input
                placeholder="e.g. Production, CI/CD, Development"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate()
                }}
              />
            </FormField>
          )}
        </div>

        <DialogFooter>
          {createdKey ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!name.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Key"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function ApiKeysPage() {
  const posthog = usePostHog()
  const { data: keys, isPending, error, refetch } = useApiKeys()
  const revokeMutation = useRevokeApiKey()
  const bulkRevoke = useBulkRevokeApiKeys()
  const [search, setSearch] = useState("")
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [createOpen, setCreateOpen] = useState(false)

  const filtered = useMemo(() => {
    if (!keys) return []
    if (!search) return keys
    return keys.filter(
      (k) =>
        k.name.toLowerCase().includes(search.toLowerCase()) ||
        k.prefix.toLowerCase().includes(search.toLowerCase()),
    )
  }, [keys, search])

  const {
    selected,
    allSelected,
    someSelected,
    toggleAll,
    toggleOne,
    clearSelection,
  } = useSelection(filtered)

  const toggleReveal = (id: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const deleteKey = (id: string) => {
    posthog.capture(API_KEY_EVENTS.REVOKED)
    revokeMutation.mutate(id)
  }

  const deleteSelected = () => {
    const ids = Array.from(selected)
    posthog.capture(API_KEY_EVENTS.BULK_REVOKED, { count: ids.length })
    bulkRevoke.mutate(ids)
    clearSelection()
  }

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="API Keys" />
        <TableSkeleton columns={6} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="API Keys" />
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </div>
    )
  }

  const isEmpty = !keys || keys.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="API Keys">
        {!isEmpty && (
          <CreateKeyDialog />
        )}
      </PageHeader>

      {isEmpty ? (
        <>
          <EmptyState
            icon={KeyIcon}
            title="No API Keys"
            description="Create an API key to authenticate with the Superserve SDK."
            actionLabel="Create Key"
            onAction={() => setCreateOpen(true)}
          />
          <CreateKeyDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
          />
        </>
      ) : (
        <>
          <TableToolbar
            searchPlaceholder="Search keys..."
            searchValue={search}
            onSearchChange={setSearch}
            selectedCount={selected.size}
            onClearSelection={clearSelection}
            onDeleteSelected={deleteSelected}
          />

          <div className="flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <Checkbox
                      checked={someSelected ? "indeterminate" : allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all keys"
                    />
                  </TableHead>
                  <TableHead className="w-[20%]">Name</TableHead>
                  <TableHead className="w-[35%]">Key</TableHead>
                  <TableHead className="w-[15%]">Created</TableHead>
                  <TableHead className="w-[15%]">Last Used</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <StickyHoverTableBody>
                {filtered.map((apiKey) => (
                  <TableRow key={apiKey.id}>
                    <TableCell className="pr-0">
                      <Checkbox
                        checked={selected.has(apiKey.id)}
                        onCheckedChange={() => toggleOne(apiKey.id)}
                        aria-label={`Select ${apiKey.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{apiKey.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-xs text-muted">
                          {revealedKeys.has(apiKey.id)
                            ? apiKey.prefix
                            : maskKey(apiKey.prefix)}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => toggleReveal(apiKey.id)}
                          aria-label={
                            revealedKeys.has(apiKey.id)
                              ? "Hide key"
                              : "Reveal key"
                          }
                        >
                          {revealedKeys.has(apiKey.id) ? (
                            <EyeSlashIcon className="size-3.5" weight="light" />
                          ) : (
                            <EyeIcon className="size-3.5" weight="light" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted">
                      {formatDate(new Date(apiKey.created_at))}
                    </TableCell>
                    <TableCell className="text-muted">
                      {apiKey.last_used_at
                        ? formatDate(new Date(apiKey.last_used_at))
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Key actions"
                          >
                            <DotsThreeVerticalIcon
                              className="size-4"
                              weight="bold"
                            />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={async () => {
                              await navigator.clipboard.writeText(apiKey.prefix)
                            }}
                          >
                            <CopyIcon className="size-4" weight="light" />
                            Copy Key
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteKey(apiKey.id)}
                          >
                            <TrashIcon className="size-4" weight="light" />
                            Revoke Key
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </StickyHoverTableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/app/\(dashboard\)/api-keys/page.tsx && git commit -m "console: wire API keys page to API with TanStack Query"
```

---

### Task 20: Wire Up Snapshots Page

**Files:**
- Modify: `apps/console/src/app/(dashboard)/snapshots/page.tsx`

- [ ] **Step 1: Update the snapshots page**

Replace the file. Key changes:

- Remove `MOCK_SNAPSHOTS` and `useState`
- Use `useQuery` directly with `snapshotKeys` and a fetch function
- Add loading/error states
- Map `SnapshotEntry` fields from mock API response

```tsx
// apps/console/src/app/(dashboard)/snapshots/page.tsx

"use client"

import { CameraIcon, DotsThreeVerticalIcon } from "@phosphor-icons/react"
import {
  Button,
  Checkbox,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { useSelection } from "@/hooks/use-selection"
import { apiClient } from "@/lib/api/client"
import { snapshotKeys } from "@/lib/api/query-keys"
import { formatDate } from "@/lib/format"

interface Snapshot {
  id: string
  name: string
  created_at: string
  last_used_at: string | null
}

export default function SnapshotsPage() {
  const {
    data: snapshots,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: snapshotKeys.all,
    queryFn: () => apiClient<Snapshot[]>("/v1/snapshots"),
  })

  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!snapshots) return []
    if (!search) return snapshots
    return snapshots.filter((s) =>
      s.name.toLowerCase().includes(search.toLowerCase()),
    )
  }, [snapshots, search])

  const { selected, allSelected, someSelected, toggleAll, toggleOne } =
    useSelection(filtered)

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Snapshots" />
        <TableSkeleton columns={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Snapshots" />
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </div>
    )
  }

  const isEmpty = !snapshots || snapshots.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Snapshots" />

      {isEmpty ? (
        <EmptyState
          icon={CameraIcon}
          title="No Snapshots"
          description="Snapshots are created automatically when you pause a sandbox."
        />
      ) : (
        <>
          <TableToolbar
            searchPlaceholder="Search snapshots..."
            searchValue={search}
            onSearchChange={setSearch}
          />

          <div className="flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <Checkbox
                      checked={someSelected ? "indeterminate" : allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all snapshots"
                    />
                  </TableHead>
                  <TableHead className="w-[40%]">Name</TableHead>
                  <TableHead className="w-[20%]">Created</TableHead>
                  <TableHead className="w-[20%]">Last Used</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <StickyHoverTableBody>
                {filtered.map((snapshot) => (
                  <TableRow key={snapshot.id}>
                    <TableCell className="pr-0">
                      <Checkbox
                        checked={selected.has(snapshot.id)}
                        onCheckedChange={() => toggleOne(snapshot.id)}
                        aria-label={`Select ${snapshot.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-foreground/80">
                      {snapshot.name}
                    </TableCell>
                    <TableCell className="text-muted">
                      {snapshot.created_at
                        ? formatDate(new Date(snapshot.created_at))
                        : "-"}
                    </TableCell>
                    <TableCell className="text-muted">
                      {snapshot.last_used_at
                        ? formatDate(new Date(snapshot.last_used_at))
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Snapshot actions"
                      >
                        <DotsThreeVerticalIcon
                          className="size-4"
                          weight="bold"
                        />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </StickyHoverTableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/app/\(dashboard\)/snapshots/page.tsx && git commit -m "console: wire snapshots page to API with TanStack Query"
```

---

### Task 21: Wire Up Audit Logs Page

**Files:**
- Modify: `apps/console/src/app/(dashboard)/audit-logs/page.tsx`

- [ ] **Step 1: Update the audit logs page**

Replace the file. Key changes:

- Remove `MOCK_AUDIT_LOGS` and `useState`
- Use `useQuery` with `auditLogKeys` and fetch from `/v1/audit-logs`
- Add loading/error states
- Map string timestamps to Date objects for `formatTime`

```tsx
// apps/console/src/app/(dashboard)/audit-logs/page.tsx

"use client"

import { ClipboardTextIcon } from "@phosphor-icons/react"
import {
  Badge,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { apiClient } from "@/lib/api/client"
import { auditLogKeys } from "@/lib/api/query-keys"
import { formatTime } from "@/lib/format"

type AuditOutcome = "Success" | "Failure"

interface AuditLog {
  id: string
  time: string
  user: string
  action: string
  target: string
  outcome: AuditOutcome
}

const OUTCOME_BADGE_VARIANT: Record<AuditOutcome, "success" | "destructive"> = {
  Success: "success",
  Failure: "destructive",
}

const ACTION_TABS = [
  { label: "All", value: "all" },
  { label: "Create", value: "Create" },
  { label: "Start", value: "Start" },
  { label: "Pause", value: "Pause" },
  { label: "Update", value: "Update" },
]

function TimeCell({ date }: { date: Date }) {
  const { relative, absolute } = formatTime(date)
  return (
    <div>
      <span className="text-foreground/80">{relative}</span>
      <span className="ml-2 text-xs text-muted">{absolute}</span>
    </div>
  )
}

export default function AuditLogsPage() {
  const {
    data: logs,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: auditLogKeys.all,
    queryFn: () => apiClient<AuditLog[]>("/v1/audit-logs"),
  })

  const [actionFilter, setActionFilter] = useState("all")
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!logs) return []
    return logs.filter((log) => {
      if (actionFilter !== "all" && log.action !== actionFilter) return false
      if (
        search &&
        !log.user.toLowerCase().includes(search.toLowerCase()) &&
        !log.target.toLowerCase().includes(search.toLowerCase())
      )
        return false
      return true
    })
  }, [logs, actionFilter, search])

  const tabs = ACTION_TABS.map((tab) => ({
    ...tab,
    count:
      tab.value === "all"
        ? (logs?.length ?? 0)
        : (logs?.filter((l) => l.action === tab.value).length ?? 0),
  }))

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Audit Logs" />
        <TableSkeleton columns={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Audit Logs" />
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </div>
    )
  }

  const isEmpty = !logs || logs.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Audit Logs" />

      {isEmpty ? (
        <EmptyState
          icon={ClipboardTextIcon}
          title="No Activity Yet"
          description="Audit logs will appear here once you start using Superserve."
        />
      ) : (
        <>
          <TableToolbar
            tabs={tabs}
            activeTab={actionFilter}
            onTabChange={setActionFilter}
            searchPlaceholder="Search by user or target..."
            searchValue={search}
            onSearchChange={setSearch}
          />

          <div className="flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[22%]">Time</TableHead>
                  <TableHead className="w-[22%]">User</TableHead>
                  <TableHead className="w-[12%]">Action</TableHead>
                  <TableHead className="w-[30%]">Target</TableHead>
                  <TableHead className="w-[14%]">Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <StickyHoverTableBody>
                {filtered.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap">
                      <TimeCell date={new Date(log.time)} />
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {log.user}
                    </TableCell>
                    <TableCell>{log.action}</TableCell>
                    <TableCell className="max-w-48 truncate text-foreground/80">
                      {log.target}
                    </TableCell>
                    <TableCell>
                      <Badge variant={OUTCOME_BADGE_VARIANT[log.outcome]} dot>
                        {log.outcome}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </StickyHoverTableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/app/\(dashboard\)/audit-logs/page.tsx && git commit -m "console: wire audit logs page to API with TanStack Query"
```

---

### Task 22: Wire Up Get Started Page

**Files:**
- Modify: `apps/console/src/app/(dashboard)/get-started/page.tsx`

- [ ] **Step 1: Update the get started page**

Modify to use `useCreateApiKey` instead of `generateMockKey()`. Changes:

- Remove `generateMockKey()` function
- Import `useCreateApiKey` from `@/hooks/use-api-keys`
- Replace `handleCreateKey` to call `createMutation.mutate("Get Started Key")`
- Show the created key from mutation response data
- Disable button while `isPending`

In `apps/console/src/app/(dashboard)/get-started/page.tsx`, replace the `generateMockKey` function and update `GetStartedPage`:

Remove:
```ts
function generateMockKey(): { full: string; prefix: string } {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let key = ""
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)]
  }
  const full = `ss_live_${key}`
  const prefix = `ss_live_${key.slice(0, 8)}...`
  return { full, prefix }
}
```

Add import:
```ts
import { useCreateApiKey } from "@/hooks/use-api-keys"
```

In `GetStartedPage`, replace:
```ts
const [createdKey, setCreatedKey] = useState<{ full: string; prefix: string } | null>(null)
```
with:
```ts
const createKeyMutation = useCreateApiKey()
const createdKey = createKeyMutation.data
  ? { full: createKeyMutation.data.key, prefix: createKeyMutation.data.prefix }
  : null
```

Replace `handleCreateKey`:
```ts
const handleCreateKey = () => {
  createKeyMutation.mutate("Get Started Key")
}
```

Update the Create Key button to disable while pending:
```tsx
<Button
  onClick={handleCreateKey}
  size="sm"
  disabled={createKeyMutation.isPending}
>
  <PlusIcon className="size-3.5" weight="light" />
  {createKeyMutation.isPending ? "Creating..." : "Create Key"}
</Button>
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/src/app/\(dashboard\)/get-started/page.tsx && git commit -m "console: wire get started page to use API key mutation"
```

---

### Task 23: Update NEXT_PUBLIC_API_URL for Mock Server

**Files:**
- Modify: `apps/console/.env.example`

- [ ] **Step 1: Update .env.example**

Change `NEXT_PUBLIC_API_URL` to point to the mock routes in development:

In `apps/console/.env.example`, change:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```
to:
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

Also update your local `.env` file to match (not committed).

- [ ] **Step 2: Commit**

```bash
cd /Users/nirnejak/Code/superserve/superserve && git add apps/console/.env.example && git commit -m "console: update API URL to point to mock routes in dev"
```

---

### Task 24: Verify End-to-End

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run dev --filter=@superserve/console
```

- [ ] **Step 2: Verify mock API**

```bash
curl -s -H "X-API-Key: test" http://localhost:3001/api/v1/health
curl -s -H "X-API-Key: test" http://localhost:3001/api/v1/sandboxes | head -c 200
curl -s -H "X-API-Key: test" http://localhost:3001/api/v1/api-keys | head -c 200
curl -s -H "X-API-Key: test" http://localhost:3001/api/v1/snapshots | head -c 200
curl -s -H "X-API-Key: test" http://localhost:3001/api/v1/audit-logs | head -c 200
```

Expected: JSON responses for all endpoints.

- [ ] **Step 3: Verify pages load in browser**

Open `http://localhost:3001` in browser, sign in, and check:
- `/sandboxes` — shows mock sandbox data with correct statuses
- `/api-keys` — shows mock API keys
- `/snapshots` — shows mock snapshots
- `/audit-logs` — shows mock audit logs
- `/get-started` — "Create Key" button works and creates via API

- [ ] **Step 4: Run typecheck and lint**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/console && bunx turbo run lint --filter=@superserve/console
```

Expected: Both PASS.

- [ ] **Step 5: Run tests**

```bash
cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run test --filter=@superserve/console
```

Expected: All existing tests pass.
