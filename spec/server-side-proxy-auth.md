# Server-Side Proxy Auth: Remove Client-Side API Keys

## Problem

The console currently provisions a hidden `__console_dashboard__` API key, stores it in localStorage, and attaches it as `X-API-Key` on every client-side request. This is:

- **Insecure** — API key in localStorage is exposed to XSS
- **Fragile** — breaks silently if the key is revoked or localStorage is cleared mid-session
- **Unnecessary complexity** — the user is already authenticated via Supabase session; the API key is an implementation detail the client shouldn't manage

## Solution

Move API key management entirely into the Next.js proxy route. The client sends requests to `/api/...` with no auth headers. The proxy validates the Supabase session, resolves the team, and injects the API key server-side before forwarding to the sandbox backend.

## Architecture

```
Browser (no API key)
  → /api/sandboxes/...
  → Next.js proxy route (server-side)
    1. Read Supabase session from cookie
    2. Resolve team_id for user
    3. Get or create an internal API key (cached in-memory)
    4. Inject X-API-Key header
    5. Forward to SANDBOX_API_URL
```

## Changes

### 1. Update proxy route (`src/app/api/[...path]/route.ts`)

- Import `createServerClient` from Supabase
- On each request:
  - Get the authenticated user from the session cookie
  - Call a helper to resolve team + get/create an API key
  - Inject the key into forwarded headers
  - Return 401 if no valid session (except for public paths like `v1/auth/device-authorize`)
- Cache the resolved key in a short-lived in-memory Map (keyed by user ID, TTL ~60s) to avoid hitting Supabase on every request

### 2. Create helper (`src/lib/api/proxy-auth.ts`)

- `getProxyApiKey(userId: string): Promise<string>`
  - Checks in-memory cache first
  - Falls back to Supabase: look up team for user, find or create a `__console_proxy__` key
  - Caches result with TTL
- Reuses existing `getOrCreateTeamForUser`, `generateRawKey`, `hashKey` from `api-keys-actions.ts`

### 3. Remove client-side API key handling

- **Delete** `src/components/api-key-provider.tsx`
- **Remove** `ApiKeyProvider` from the dashboard layout
- **Simplify** `src/lib/api/client.ts`:
  - Remove `getApiKey()`, `setApiKey()`, `clearApiKey()`
  - Remove localStorage usage
  - Remove `X-API-Key` header injection
- **Simplify** direct fetch calls in:
  - `src/hooks/use-exec-stream.ts` — remove apiKey header
  - `src/lib/api/files.ts` — remove apiKey header
  - `src/lib/api/exec.ts` — remove apiKey header

### 4. Clean up `ensureDashboardApiKeyAction`

- Remove `ensureDashboardApiKeyAction` from `src/lib/api/api-keys-actions.ts`
- The proxy uses its own server-side helper instead

### 5. Device auth (no change needed)

The device auth endpoint (`/api/v1/auth/device-authorize`) uses `Authorization: Bearer <session_token>`, not API keys. It will continue to work — the proxy just needs to skip key injection for `v1/auth/` paths since the bearer token is already present.

## Files to Modify

| File | Action |
|------|--------|
| `src/app/api/[...path]/route.ts` | Add session validation + key injection |
| `src/lib/api/proxy-auth.ts` | **New** — server-side key resolution with cache |
| `src/lib/api/client.ts` | Remove API key logic and localStorage |
| `src/hooks/use-exec-stream.ts` | Remove apiKey header |
| `src/lib/api/files.ts` | Remove apiKey header |
| `src/lib/api/exec.ts` | Remove apiKey header |
| `src/components/api-key-provider.tsx` | **Delete** |
| `src/app/(dashboard)/layout.tsx` | Remove ApiKeyProvider |
| `src/lib/api/api-keys-actions.ts` | Remove `ensureDashboardApiKeyAction` |
| `src/app/(dashboard)/api-keys/page.tsx` | Remove `__console_dashboard__` filter (no longer needed) |

## Edge Cases

- **Unauthenticated requests**: Proxy returns 401. Middleware already redirects to sign-in for protected routes, so this is a fallback.
- **Key revocation**: If someone revokes the `__console_proxy__` key via direct DB access, the in-memory cache expires in ~60s, and the proxy creates a new one automatically.
- **Concurrent requests on cold start**: Multiple requests may race to create the key. The helper should handle this with a per-user promise dedup (only one in-flight creation per user).
