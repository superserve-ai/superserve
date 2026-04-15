# Console API Integration Design

**Date:** 2026-04-04
**Status:** Approved

## Overview

Connect the console UI to the Superserve backend API (currently under development at `api.superserve.ai`) using mock Route Handlers for development and a typed API client + TanStack Query for data fetching. When the real backend ships, flip `NEXT_PUBLIC_API_URL` — zero code changes needed.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Console App                     │
│                                                  │
│  ┌──────────┐   ┌──────────────┐   ┌──────────┐ │
│  │  Pages    │──▶│ TanStack     │──▶│ API      │─┼──▶ Mock Route Handlers (dev)
│  │          │   │ Query hooks  │   │ Client   │─┼──▶ api.superserve.ai (prod)
│  └──────────┘   └──────────────┘   └──────────┘ │
│                                                  │
│  ┌──────────┐   ┌──────────────┐                │
│  │  Auth    │──▶│ Supabase     │  (unchanged)   │
│  │  Pages   │   │ Client       │                │
│  └──────────┘   └──────────────┘                │
└─────────────────────────────────────────────────┘
```

**Layers:**

1. **API Client** (`lib/api/client.ts`) — typed fetch wrapper, injects `X-API-Key`, normalizes errors to `ApiError`.
2. **API Resource modules** (`lib/api/sandboxes.ts`, etc.) — typed functions per resource.
3. **TanStack Query hooks** (`hooks/use-sandboxes.ts`, etc.) — wire resource functions into `useQuery`/`useMutation`.
4. **Mock Route Handlers** (`app/api/v1/...`) — implement the OpenAPI spec with in-memory data.
5. **Supabase stays for auth only** — `useUser`, `useAgents`, middleware untouched.

## API Client

### `lib/api/client.ts`

Single fetch wrapper that:
- Prepends `NEXT_PUBLIC_API_URL` to all paths
- Injects `X-API-Key` header (read from localStorage, set when user creates a key on the API Keys or Get Started page)
- Parses JSON responses
- Throws `ApiError` on 4xx/5xx (normalized from the OpenAPI `Error` schema)
- No retry logic (TanStack Query handles retry)

```ts
class ApiError extends Error {
  status: number
  code: string
  message: string
}
```

### Resource modules

```
lib/api/
├── client.ts          # fetch wrapper + ApiError
├── sandboxes.ts       # listSandboxes, getSandbox, createSandbox, deleteSandbox, pauseSandbox, resumeSandbox
├── exec.ts            # execCommand, execCommandStream (SSE)
├── files.ts           # uploadFile, downloadFile
└── types.ts           # SandboxResponse, CreateSandboxRequest, ExecRequest, ExecResult, etc.
```

### Error handling strategy

- `ApiError` is the single error type across the app
- TanStack Query's `retry: 3` with exponential backoff handles transient failures
- `401` errors → no retry, redirect to sign-in
- `409` (conflict) → no retry, show toast ("Sandbox is not in a valid state")
- `onError` callbacks in mutations → toast notifications via existing `useToast`

## TanStack Query Integration

### Provider setup

`QueryClientProvider` added to dashboard layout with defaults:

- `staleTime: 30s` — data considered fresh for 30s
- `gcTime: 5min` — unused cache garbage collected after 5min
- `retry: 3` — retry failed requests 3 times
- `refetchOnWindowFocus: true` — refresh when user tabs back

### Query key factory

```ts
// lib/api/query-keys.ts
export const sandboxKeys = {
  all:    ["sandboxes"],
  list:   (filters) => ["sandboxes", "list", filters],
  detail: (id) => ["sandboxes", "detail", id],
}
```

### Hooks

```
hooks/
├── use-sandboxes.ts       # useSandboxes(), useSandbox(id), useCreateSandbox(), useDeleteSandbox(), usePauseSandbox(), useResumeSandbox()
├── use-api-keys.ts        # useApiKeys(), useCreateApiKey(), useRevokeApiKey()
└── use-exec.ts            # useExecCommand() — mutation only, no caching
```

### Optimistic updates

- **Delete sandbox** → remove from list cache immediately, rollback on error
- **Create sandbox** → add to list with `status: "starting"`, refetch confirms
- **Pause/Resume** → update status in cache immediately
- **Revoke API key** → remove from list immediately

### Status polling

After `createSandbox` mutation succeeds:

```ts
useQuery({
  queryKey: sandboxKeys.detail(id),
  queryFn: () => getSandbox(id),
  refetchInterval: (query) =>
    query.state.data?.status === "starting" ? 2000 : false,
})
```

Polls every 2s while `"starting"`, stops when `"active"`.

### Loading/error states

```tsx
const { data, isPending, error } = useSandboxes(filters)

if (isPending) return <TableSkeleton />
if (error) return <ErrorState error={error} onRetry={refetch} />
if (data.length === 0) return <EmptyState />
```

## Mock Route Handlers

### Location

`apps/console/src/app/api/v1/` — co-located, easy to delete when backend ships.

### In-memory store

```ts
// app/api/v1/_mock/store.ts
// Sandboxes seeded with 3-5 entries across all statuses
// API keys seeded with 2-3 entries
// Audit logs seeded with 5-8 entries
// Data resets on dev server restart
```

### Routes

```
app/api/v1/
├── _mock/
│   └── store.ts                          # shared in-memory data
├── health/
│   └── route.ts                          # GET
├── sandboxes/
│   ├── route.ts                          # GET (list), POST (create)
│   └── [sandbox_id]/
│       ├── route.ts                      # GET (detail), DELETE
│       ├── pause/route.ts                # POST
│       ├── resume/route.ts               # POST
│       ├── exec/
│       │   ├── route.ts                  # POST
│       │   └── stream/route.ts           # POST → SSE
│       └── files/
│           └── [...path]/route.ts        # PUT (upload), GET (download)
```

### Behavior

- `POST /sandboxes` → creates with `status: "starting"`, `setTimeout` 3s flips to `"active"`
- `POST /pause` → validates status is `"active"`, returns 409 otherwise
- `POST /resume` → validates status is `"idle"`, returns 409 otherwise
- `DELETE` → removes from store, returns 204
- `POST /exec` → returns mock stdout/stderr after 500ms delay
- `POST /exec/stream` → streams 3-4 SSE chunks over ~2s
- All routes check for `X-API-Key` header presence (any value accepted)

### Cleanup

When backend ships: delete `app/api/v1/` directory, change `NEXT_PUBLIC_API_URL` to `https://api.superserve.ai`.

## Page Integration

| Page | Current | After |
|------|---------|-------|
| **Sandboxes** | `MOCK_SANDBOXES` array, `useState` | `useSandboxes()` query, `useCreateSandbox()` / `useDeleteSandbox()` / `usePauseSandbox()` / `useResumeSandbox()` mutations. Skeleton loader, error state, optimistic deletes. |
| **API Keys** | `INITIAL_KEYS` array, `useState`, `generateMockKey()` | `useApiKeys()` query, `useCreateApiKey()` / `useRevokeApiKey()` mutations. Create flow returns key from mock API. |
| **Snapshots** | `MOCK_SNAPSHOTS` array, `useState` | Read-only `useQuery` against mock endpoint. No mutations (snapshots created via pause). |
| **Audit Logs** | `MOCK_AUDIT_LOGS` array, `useState` | Read-only `useQuery` against mock endpoint. Mock store appends entries on sandbox/key mutations. |
| **Get Started** | `generateMockKey()` inline | Reuses `useCreateApiKey()` mutation. |

### Unchanged

- Auth pages (Supabase)
- `useUser` / `useAgents` hooks (Supabase)
- Settings page (Supabase auth)
- Sidebar, layout, middleware

### New shared components

- `TableSkeleton` — animated skeleton matching table layout, reused across list pages
- `ErrorState` — error display with retry button, reused across pages

## Out of Scope

- Exec/terminal UI (no page exists yet; mock routes will exist but unwired)
- File upload/download UI (no page exists yet; mock routes will exist but unwired)
- Supabase migrations for sandboxes, snapshots, audit logs (backend concern)
- RLS policies
- SSE integration in the UI (routes exist for future use)
