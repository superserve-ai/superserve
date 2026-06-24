# Admin Team Impersonation (Read-Only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Design:** `2026-06-17-admin-impersonation-design.md`. Read it first.

**Goal:** Let Superserve staff impersonate any customer team **read-only** from the console, with no backend changes and no impact on the customer's usage/quota.

**Architecture:** All work is in `apps/console/`. A single `isStaff()` gate + a signed `ss_impersonate` cookie decide whether the current request acts as another team. The proxy injects an ephemeral, hidden `api_key` row pointed at the target team and forwards only `GET`/`HEAD`; server actions resolve the impersonated team for reads and refuse writes. Backend trusts `api_key.team_id`, so nothing in `kathmandu/` changes.

**Tech Stack:** Next.js 16 App Router, Supabase (`@supabase/ssr` + service-role client), Vitest, Bun, oxlint/oxfmt.

## Global Constraints

- No changes to `kathmandu/` (Go backend) or any Supabase migration. Console-only.
- Read-only impersonation: never forward a non-GET/HEAD method or perform a mutating server action while impersonating.
- The impersonation key is server-side only — never returned to the browser or logged.
- Staff = email on `STAFF_EMAIL_DOMAIN` (default `superserve.ai`) **and** Google provider. Never a raw email-string match.
- Sign cookies/keys with the existing `CONSOLE_PROXY_SECRET` (already required, ≥32 chars). No new required env var.
- Internal key names are `__console_proxy__` and `__console_impersonation__`; both must be hidden from any customer-facing key list.
- TS: 2-space indent, double quotes. Run `bunx oxlint --fix && bunx oxfmt --write` before each commit. Tests: `bunx turbo run test --filter=@superserve/console`.
- Commit messages: single line, conventional, no AI attribution.

---

### Task 1: Staff identity gate

**Files:**
- Create: `apps/console/src/lib/admin/staff.ts`
- Test: `apps/console/src/lib/admin/staff.test.ts`

**Interfaces:**
- Produces: `isStaff(user: User | null | undefined): boolean`, `requireStaff(): Promise<User>`

- [ ] **Step 1: Write the failing test**

```ts
import type { User } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { isStaff } from "./staff"

function user(email: string, provider = "google", providers = ["google"]): User {
  return { id: "u1", email, app_metadata: { provider, providers } } as unknown as User
}

describe("isStaff", () => {
  it("accepts a google-verified staff-domain email", () => {
    expect(isStaff(user("alejandro@superserve.ai"))).toBe(true)
  })
  it("rejects the staff domain when provider is not google", () => {
    expect(isStaff(user("attacker@superserve.ai", "email", ["email"]))).toBe(false)
  })
  it("rejects a google login on a different domain", () => {
    expect(isStaff(user("someone@gmail.com"))).toBe(false)
  })
  it("rejects null / no email", () => {
    expect(isStaff(null)).toBe(false)
    expect(isStaff({ id: "x", app_metadata: { provider: "google" } } as User)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx turbo run test --filter=@superserve/console -- staff`
Expected: FAIL — cannot find module `./staff`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { User } from "@supabase/supabase-js"

import { createServerClient } from "@/lib/supabase/server"

const DEFAULT_STAFF_DOMAIN = "superserve.ai"

function staffDomain(): string {
  return (process.env.STAFF_EMAIL_DOMAIN ?? DEFAULT_STAFF_DOMAIN).toLowerCase()
}

/**
 * True only for a Google-verified identity on the staff domain. We require the
 * google provider so a spoofed email/password signup on @superserve.ai can't
 * gain admin access (the console supports email/password too).
 */
export function isStaff(user: User | null | undefined): boolean {
  if (!user?.email) return false
  const provider = user.app_metadata?.provider as string | undefined
  const providers = user.app_metadata?.providers as string[] | undefined
  const viaGoogle =
    provider === "google" ||
    (Array.isArray(providers) && providers.includes("google"))
  if (!viaGoogle) return false
  return user.email.toLowerCase().endsWith(`@${staffDomain()}`)
}

/** Guard for admin server actions and pages. Throws if not staff. */
export async function requireStaff(): Promise<User> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!isStaff(user)) throw new Error("Forbidden: staff access required")
  return user as User
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx turbo run test --filter=@superserve/console -- staff`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint, format, commit**

```bash
bunx oxlint --fix && bunx oxfmt --write
git add apps/console/src/lib/admin/staff.ts apps/console/src/lib/admin/staff.test.ts
git commit -m "feat(console): add staff identity gate for admin impersonation"
```

---

### Task 2: Impersonation token (sign / verify / ttl)

**Files:**
- Create: `apps/console/src/lib/admin/impersonation.ts`
- Test: `apps/console/src/lib/admin/impersonation.test.ts`

**Interfaces:**
- Consumes: `getProxySecret` from `@/lib/api/proxy-auth`.
- Produces: `IMPERSONATION_COOKIE: string`, `impersonationTtlMs(): number`, `signImpersonationToken(teamId, exp): string`, `verifyImpersonationToken(token, now?): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"

import { signImpersonationToken, verifyImpersonationToken } from "./impersonation"

const TEAM = "11111111-1111-1111-1111-111111111111"

describe("impersonation token", () => {
  it("round-trips a valid unexpired token", () => {
    const exp = 10_000
    const token = signImpersonationToken(TEAM, exp)
    expect(verifyImpersonationToken(token, 9_000)).toBe(TEAM)
  })
  it("rejects an expired token", () => {
    const token = signImpersonationToken(TEAM, 1_000)
    expect(verifyImpersonationToken(token, 2_000)).toBeNull()
  })
  it("rejects a tampered team id", () => {
    const token = signImpersonationToken(TEAM, 10_000)
    const forged = token.replace(TEAM, "22222222-2222-2222-2222-222222222222")
    expect(verifyImpersonationToken(forged, 9_000)).toBeNull()
  })
  it("rejects malformed input", () => {
    expect(verifyImpersonationToken(undefined, 0)).toBeNull()
    expect(verifyImpersonationToken("a.b", 0)).toBeNull()
  })
})
```

The test setup (`apps/console/src/test/setup.ts`) already sets `CONSOLE_PROXY_SECRET`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx turbo run test --filter=@superserve/console -- impersonation`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import crypto from "node:crypto"

import { getProxySecret } from "@/lib/api/proxy-auth"

export const IMPERSONATION_COOKIE = "ss_impersonate"

const DEFAULT_TTL_MINUTES = 30

export function impersonationTtlMs(): number {
  const mins = Number(process.env.IMPERSONATION_TTL_MINUTES ?? DEFAULT_TTL_MINUTES)
  return (Number.isFinite(mins) && mins > 0 ? mins : DEFAULT_TTL_MINUTES) * 60_000
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", getProxySecret())
    .update(payload)
    .digest("base64url")
}

/** Token = `${teamId}.${exp}.${hmac}` — tamper-proof and self-expiring. */
export function signImpersonationToken(teamId: string, exp: number): string {
  const payload = `${teamId}.${exp}`
  return `${payload}.${sign(payload)}`
}

export function verifyImpersonationToken(
  token: string | undefined,
  now: number = Date.now(),
): string | null {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [teamId, expRaw, providedSig] = parts
  const expectedSig = sign(`${teamId}.${expRaw}`)
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || exp < now) return null
  return teamId
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx turbo run test --filter=@superserve/console -- impersonation`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint, format, commit**

```bash
bunx oxlint --fix && bunx oxfmt --write
git add apps/console/src/lib/admin/impersonation.ts apps/console/src/lib/admin/impersonation.test.ts
git commit -m "feat(console): add signed impersonation cookie token"
```

---

### Task 3: Resolve impersonated team + cookie set/clear

**Files:**
- Modify: `apps/console/src/lib/admin/impersonation.ts`
- Test: `apps/console/src/lib/admin/impersonation.test.ts`

**Interfaces:**
- Consumes: `isStaff` from `@/lib/admin/staff`; `cookies` from `next/headers`.
- Produces: `getImpersonationTeamId(user): Promise<string | null>`, `setImpersonationCookie(teamId): Promise<void>`, `clearImpersonationCookie(): Promise<void>`, `readImpersonationTeamId(): Promise<string | null>`.

- [ ] **Step 1: Write the failing test** (mock `next/headers` + staff)

```ts
import type { User } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"

const cookieStore = { value: undefined as string | undefined }
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (_: string) => (cookieStore.value ? { value: cookieStore.value } : undefined),
    set: () => {},
    delete: () => {
      cookieStore.value = undefined
    },
  }),
}))

import { getImpersonationTeamId, signImpersonationToken } from "./impersonation"

const TEAM = "11111111-1111-1111-1111-111111111111"
const staff = { id: "a1", email: "amit@superserve.ai", app_metadata: { provider: "google" } } as User
const customer = { id: "c1", email: "joe@gmail.com", app_metadata: { provider: "google" } } as User

afterEach(() => {
  cookieStore.value = undefined
})

describe("getImpersonationTeamId", () => {
  it("returns the team for a staff user with a valid cookie", async () => {
    cookieStore.value = signImpersonationToken(TEAM, Date.now() + 60_000)
    expect(await getImpersonationTeamId(staff)).toBe(TEAM)
  })
  it("returns null for a non-staff user even with a valid cookie", async () => {
    cookieStore.value = signImpersonationToken(TEAM, Date.now() + 60_000)
    expect(await getImpersonationTeamId(customer)).toBeNull()
  })
  it("returns null when no cookie is present", async () => {
    expect(await getImpersonationTeamId(staff)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx turbo run test --filter=@superserve/console -- impersonation`
Expected: FAIL — `getImpersonationTeamId` is not exported.

- [ ] **Step 3: Append the implementation** to `impersonation.ts`

```ts
import { cookies } from "next/headers"
import type { User } from "@supabase/supabase-js"

import { isStaff } from "@/lib/admin/staff"

export async function readImpersonationTeamId(): Promise<string | null> {
  const store = await cookies()
  return verifyImpersonationToken(store.get(IMPERSONATION_COOKIE)?.value)
}

/**
 * The team the current request should act as: the target team only when the
 * user is staff AND a valid impersonation cookie is present; otherwise null
 * (callers fall back to the user's own team).
 */
export async function getImpersonationTeamId(
  user: User | null | undefined,
): Promise<string | null> {
  if (!isStaff(user)) return null
  return readImpersonationTeamId()
}

export async function setImpersonationCookie(teamId: string): Promise<void> {
  const store = await cookies()
  const token = signImpersonationToken(teamId, Date.now() + impersonationTtlMs())
  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN
  store.set(IMPERSONATION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(impersonationTtlMs() / 1000),
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  })
}

export async function clearImpersonationCookie(): Promise<void> {
  const store = await cookies()
  store.delete(IMPERSONATION_COOKIE)
}
```

Add `import type { User }` and `import { cookies }` to the existing import block (keep imports at top, type-only import separate per oxlint).

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx turbo run test --filter=@superserve/console -- impersonation`
Expected: PASS (7 tests total).

- [ ] **Step 5: Lint, format, commit**

```bash
bunx oxlint --fix && bunx oxfmt --write
git add apps/console/src/lib/admin/impersonation.ts apps/console/src/lib/admin/impersonation.test.ts
git commit -m "feat(console): resolve impersonated team behind staff gate"
```

---

### Task 4: Extract proxy secret + derive the impersonation key

Splitting `getProxySecret`/`hashKey` into their own module avoids an import cycle (`proxy-auth` will import from `impersonation`, which imports the secret).

**Files:**
- Create: `apps/console/src/lib/api/proxy-secret.ts`
- Modify: `apps/console/src/lib/api/proxy-auth.ts` (re-export from new module)
- Create: `apps/console/src/lib/admin/impersonation-key.ts`
- Test: `apps/console/src/lib/admin/impersonation-key.test.ts`

**Interfaces:**
- Produces: `getProxySecret()`, `hashKey(key)` (moved); `deriveImpersonationKey(adminId, teamId): string`, `ensureImpersonationKeyRow(adminId, teamId, ttlMinutes?): Promise<string>`, `revokeImpersonationKeyRow(adminId, teamId): Promise<void>`, `IMPERSONATION_KEY_NAME: string`.

- [ ] **Step 1: Create `proxy-secret.ts`** (move the two functions verbatim)

```ts
import crypto from "node:crypto"

/** @internal — exported for tests. */
export function getProxySecret(): string {
  const secret = process.env.CONSOLE_PROXY_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      "CONSOLE_PROXY_SECRET env var is required and must be at least 32 characters",
    )
  }
  return secret
}

/** @internal — exported for tests. */
export function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex")
}
```

- [ ] **Step 2: Update `proxy-auth.ts`** to source them from the new module (keep the existing public surface so `proxy-auth.test.ts` still imports `getProxySecret`/`hashKey` from `proxy-auth`)

Replace the local `getProxySecret` and `hashKey` definitions with:

```ts
import { getProxySecret, hashKey } from "@/lib/api/proxy-secret"
// ... keep deriveRawKey using the imported getProxySecret ...
export { getProxySecret, hashKey } from "@/lib/api/proxy-secret"
```

- [ ] **Step 3: Run the existing proxy-auth tests to confirm no regression**

Run: `bunx turbo run test --filter=@superserve/console -- proxy-auth`
Expected: PASS (unchanged behavior).

- [ ] **Step 4: Write the failing test for the impersonation key**

```ts
import { describe, expect, it } from "vitest"

import { deriveImpersonationKey } from "./impersonation-key"

describe("deriveImpersonationKey", () => {
  it("is deterministic per (admin, team) and ss_live-prefixed", () => {
    const k1 = deriveImpersonationKey("admin-1", "team-1")
    const k2 = deriveImpersonationKey("admin-1", "team-1")
    expect(k1).toBe(k2)
    expect(k1.startsWith("ss_live_")).toBe(true)
  })
  it("differs per admin and per team", () => {
    expect(deriveImpersonationKey("admin-1", "team-1")).not.toBe(
      deriveImpersonationKey("admin-2", "team-1"),
    )
    expect(deriveImpersonationKey("admin-1", "team-1")).not.toBe(
      deriveImpersonationKey("admin-1", "team-2"),
    )
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `bunx turbo run test --filter=@superserve/console -- impersonation-key`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement `impersonation-key.ts`**

```ts
import crypto from "node:crypto"

import { getProxySecret, hashKey } from "@/lib/api/proxy-secret"
import { createAdminClient } from "@/lib/supabase/admin"

export const IMPERSONATION_KEY_NAME = "__console_impersonation__"
const IMPERSONATION_KEY_VERSION = "v1"
const DEFAULT_TTL_MINUTES = 30

/** Deterministic per (admin, team) so platform attribution stays per-individual. */
export function deriveImpersonationKey(adminId: string, teamId: string): string {
  const mac = crypto
    .createHmac("sha256", getProxySecret())
    .update(`imp:${IMPERSONATION_KEY_VERSION}:${adminId}:${teamId}`)
    .digest()
  return `ss_live_${mac.toString("base64url")}`
}

/**
 * Upsert the ephemeral api_key row mapping the impersonation key to the target
 * team. Refreshes expires_at and clears revoked_at on every call so an active
 * session stays valid; the backend rejects the key once expires_at passes.
 */
export async function ensureImpersonationKeyRow(
  adminId: string,
  teamId: string,
  ttlMinutes: number = DEFAULT_TTL_MINUTES,
): Promise<string> {
  const rawKey = deriveImpersonationKey(adminId, teamId)
  const admin = createAdminClient()
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString()
  const { error } = await admin.from("api_key").upsert(
    {
      team_id: teamId,
      key_hash: hashKey(rawKey),
      name: IMPERSONATION_KEY_NAME,
      scopes: [],
      created_by: adminId,
      expires_at: expiresAt,
      revoked_at: null,
    },
    { onConflict: "key_hash" },
  )
  if (error) throw new Error(`Failed to ensure impersonation key: ${error.message}`)
  return rawKey
}

export async function revokeImpersonationKeyRow(
  adminId: string,
  teamId: string,
): Promise<void> {
  const rawKey = deriveImpersonationKey(adminId, teamId)
  const admin = createAdminClient()
  await admin
    .from("api_key")
    .update({ revoked_at: new Date().toISOString() })
    .eq("key_hash", hashKey(rawKey))
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `bunx turbo run test --filter=@superserve/console -- impersonation-key`
Expected: PASS (2 tests).

- [ ] **Step 8: Lint, format, commit**

```bash
bunx oxlint --fix && bunx oxfmt --write
git add apps/console/src/lib/api/proxy-secret.ts apps/console/src/lib/api/proxy-auth.ts apps/console/src/lib/admin/impersonation-key.ts apps/console/src/lib/admin/impersonation-key.test.ts
git commit -m "feat(console): derive ephemeral per-admin impersonation api key"
```

---

### Task 5: Wire the proxy key resolver to impersonation

**Files:**
- Modify: `apps/console/src/lib/api/proxy-auth.ts`

**Interfaces:**
- Consumes: `getImpersonationTeamId`, `impersonationTtlMs` from `@/lib/admin/impersonation`; `ensureImpersonationKeyRow` from `@/lib/admin/impersonation-key`.
- Produces: `getAuthApiKeyForUser(user: User | null): Promise<string | null>` (new), `getAuthApiKey()` (now delegates).

- [ ] **Step 1: Add the user-scoped resolver and refactor `getAuthApiKey`**

```ts
import type { User } from "@supabase/supabase-js"

import {
  getImpersonationTeamId,
  impersonationTtlMs,
} from "@/lib/admin/impersonation"
import { ensureImpersonationKeyRow } from "@/lib/admin/impersonation-key"

export async function getAuthApiKeyForUser(
  user: User | null,
): Promise<string | null> {
  if (!user) return null

  const impersonatedTeamId = await getImpersonationTeamId(user)
  if (impersonatedTeamId) {
    return ensureImpersonationKeyRow(
      user.id,
      impersonatedTeamId,
      Math.floor(impersonationTtlMs() / 60_000),
    )
  }

  const rawKey = deriveRawKey(user.id)
  await ensureProxyKeyRow(user.id, user.email ?? user.id, hashKey(rawKey))
  return rawKey
}

export async function getAuthApiKey(): Promise<string | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return getAuthApiKeyForUser(user)
}
```

- [ ] **Step 2: Run the proxy-auth + impersonation suites**

Run: `bunx turbo run test --filter=@superserve/console -- "proxy-auth|impersonation"`
Expected: PASS (no regressions; `getAuthApiKey` still returns the own-team key when not impersonating).

- [ ] **Step 3: Lint, format, commit**

```bash
bunx oxlint --fix && bunx oxfmt --write
git add apps/console/src/lib/api/proxy-auth.ts
git commit -m "feat(console): inject impersonation key in proxy auth when active"
```

---

### Task 6: Proxy route — GET/HEAD-only while impersonating

**Files:**
- Modify: `apps/console/src/app/api/[...path]/route.ts`
- Test: `apps/console/src/app/api/[...path]/route.test.ts`

**Interfaces:**
- Consumes: `getImpersonationTeamId` from `@/lib/admin/impersonation`; `getAuthApiKeyForUser` from `@/lib/api/proxy-auth`; `createServerClient`.

- [ ] **Step 1: Write the failing test** (mock supabase user + impersonation true; assert a POST is rejected 403)

```ts
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "a1", email: "amit@superserve.ai", app_metadata: { provider: "google" } } } }) },
  }),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationTeamId: async () => "team-1",
}))
vi.mock("@/lib/api/proxy-auth", () => ({ getAuthApiKeyForUser: async () => "ss_live_x" }))

import { POST } from "./route"

describe("proxy read-only impersonation gate", () => {
  it("rejects a POST with 403 while impersonating", async () => {
    const req = new Request("http://localhost/api/sandboxes", { method: "POST" }) as never
    const res = await POST(req, { params: Promise.resolve({ path: ["sandboxes"] }) })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx turbo run test --filter=@superserve/console -- "api/.*route"`
Expected: FAIL — POST currently returns the upstream/fetch result, not 403.

- [ ] **Step 3: Implement the gate** in `proxyRequest`, right after the `isAllowedPath` check

```ts
import { getImpersonationTeamId } from "@/lib/admin/impersonation"
import { getAuthApiKeyForUser } from "@/lib/api/proxy-auth"
import { createServerClient } from "@/lib/supabase/server"

// inside proxyRequest, after the 404 isAllowedPath guard:
const supabase = await createServerClient()
const {
  data: { user },
} = await supabase.auth.getUser()
const impersonating = (await getImpersonationTeamId(user)) !== null
const isReadMethod = request.method === "GET" || request.method === "HEAD"
if (impersonating && !isReadMethod) {
  return NextResponse.json(
    {
      error: {
        code: "read_only_impersonation",
        message: "Write operations are disabled while viewing another team.",
      },
    },
    { status: 403 },
  )
}
```

Then replace the key-injection block to reuse `user`:

```ts
if (!shouldSkipKeyInjection(joinedPath)) {
  const apiKey = await getAuthApiKeyForUser(user)
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Not authenticated" } },
      { status: 401 },
    )
  }
  headers.set("X-API-Key", apiKey)
}
```

(Remove the old `import { getAuthApiKey }` usage.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx turbo run test --filter=@superserve/console -- "api/.*route"`
Expected: PASS.

- [ ] **Step 5: Lint, format, commit**

```bash
bunx oxlint --fix && bunx oxfmt --write
git add "apps/console/src/app/api/[...path]/route.ts" "apps/console/src/app/api/[...path]/route.test.ts"
git commit -m "feat(console): forward only GET/HEAD through proxy while impersonating"
```

---

### Task 7: Server actions — impersonated reads + write guards + hide internal keys

**Files:**
- Modify: `apps/console/src/lib/api/api-keys-actions.ts`
- Modify: `apps/console/src/lib/api/activity-actions.ts`
- Modify: `apps/console/src/lib/api/snapshots-actions.ts`
- Test: `apps/console/src/lib/api/api-keys-actions.test.ts`

**Interfaces:**
- Consumes: `getImpersonationTeamId` from `@/lib/admin/impersonation`.

- [ ] **Step 1: `api-keys-actions.ts`** — read the impersonated team for the list, block writes, hide internal keys.

In `listApiKeysAction`, after fetching `user`:

```ts
const impersonatedTeamId = await getImpersonationTeamId(user)
const teamId =
  impersonatedTeamId ?? (await getOrCreateTeamForUser(user.id, user.email ?? user.id))
```

and add to the query chain:

```ts
.neq("name", "__console_proxy__")
.neq("name", "__console_impersonation__")
```

At the top of `createApiKeyAction` and `revokeApiKeyAction`, after `user`:

```ts
if (await getImpersonationTeamId(user)) {
  throw new Error("Read-only: cannot modify API keys while viewing another team.")
}
```

- [ ] **Step 2: `activity-actions.ts` and `snapshots-actions.ts`** — resolve the impersonated team for reads. In each list action, replace `const teamId = await getTeamId(user.id)` with:

```ts
const teamId = (await getImpersonationTeamId(user)) ?? (await getTeamId(user.id))
```

(Add `import { getImpersonationTeamId } from "@/lib/admin/impersonation"` to both files.)

- [ ] **Step 3: Write a test** asserting `createApiKeyAction` throws while impersonating (mock `getImpersonationTeamId` → a team id, mock supabase user) and that `listApiKeysAction` filters internal names.

```ts
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin/impersonation", () => ({ getImpersonationTeamId: async () => "team-1" }))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "a1", email: "amit@superserve.ai" } } }) },
  }),
}))

import { createApiKeyAction } from "./api-keys-actions"

describe("createApiKeyAction while impersonating", () => {
  it("refuses to mint a key", async () => {
    await expect(createApiKeyAction("escape")).rejects.toThrow(/Read-only/)
  })
})
```

- [ ] **Step 4: Run tests**

Run: `bunx turbo run test --filter=@superserve/console -- "actions"`
Expected: PASS.

- [ ] **Step 5: Lint, format, commit**

```bash
bunx oxlint --fix && bunx oxfmt --write
git add apps/console/src/lib/api/api-keys-actions.ts apps/console/src/lib/api/activity-actions.ts apps/console/src/lib/api/snapshots-actions.ts apps/console/src/lib/api/api-keys-actions.test.ts
git commit -m "feat(console): scope reads to impersonated team and block writes"
```

---

### Task 8: Audit log + admin server actions

**Files:**
- Create: `apps/console/src/lib/admin/audit.ts`
- Create: `apps/console/src/lib/admin/teams-actions.ts`
- Test: `apps/console/src/lib/admin/teams-actions.test.ts`

**Interfaces:**
- Consumes: `requireStaff`; `setImpersonationCookie`/`clearImpersonationCookie`/`readImpersonationTeamId`; `revokeImpersonationKeyRow`; `createAdminClient`; `sendToSlackHook` (default export of `@/lib/slack/send-to-webhook`).
- Produces: `logImpersonationEvent(e): Promise<void>`; `listAllTeamsAction()`, `startImpersonationAction(teamId)`, `stopImpersonationAction()`.

- [ ] **Step 1: Implement `audit.ts`**

```ts
import sendToSlackHook from "@/lib/slack/send-to-webhook"

type ImpersonationEvent = {
  action: "start" | "stop"
  adminId: string
  adminEmail: string
  teamId: string
  teamName?: string
}

/** Per-individual, non-blocking audit. Never throws. */
export async function logImpersonationEvent(e: ImpersonationEvent): Promise<void> {
  console.info(
    "[admin-impersonation]",
    JSON.stringify({ ...e, ts: new Date().toISOString() }),
  )
  try {
    const verb = e.action === "start" ? "started impersonating" : "stopped impersonating"
    await sendToSlackHook({
      text: `:detective: ${e.adminEmail} ${verb} team ${e.teamName ?? e.teamId}`,
    })
  } catch {
    // Slack is best-effort; the structured log above is the source of truth.
  }
}
```

- [ ] **Step 2: Implement `teams-actions.ts`**

```ts
"use server"

import { redirect } from "next/navigation"

import { logImpersonationEvent } from "@/lib/admin/audit"
import {
  clearImpersonationCookie,
  readImpersonationTeamId,
  setImpersonationCookie,
} from "@/lib/admin/impersonation"
import { revokeImpersonationKeyRow } from "@/lib/admin/impersonation-key"
import { requireStaff } from "@/lib/admin/staff"
import { createAdminClient } from "@/lib/supabase/admin"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function listAllTeamsAction() {
  await requireStaff()
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("team")
    .select("id, name, active_sandbox_count, max_sandboxes, created_at")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function startImpersonationAction(teamId: string) {
  const user = await requireStaff()
  if (!UUID_RE.test(teamId)) throw new Error("Invalid team id")

  const admin = createAdminClient()
  const { data: team } = await admin
    .from("team")
    .select("id, name")
    .eq("id", teamId)
    .single()
  if (!team) throw new Error("Team not found")

  await setImpersonationCookie(teamId)
  await logImpersonationEvent({
    action: "start",
    adminId: user.id,
    adminEmail: user.email ?? user.id,
    teamId,
    teamName: team.name as string,
  })
  redirect("/sandboxes")
}

export async function stopImpersonationAction() {
  const user = await requireStaff()
  const teamId = await readImpersonationTeamId()
  await clearImpersonationCookie()
  if (teamId) {
    await revokeImpersonationKeyRow(user.id, teamId)
    await logImpersonationEvent({
      action: "stop",
      adminId: user.id,
      adminEmail: user.email ?? user.id,
      teamId,
    })
  }
  redirect("/admin")
}
```

- [ ] **Step 3: Write a test** asserting `listAllTeamsAction` throws for a non-staff user (mock `requireStaff` to throw) — verifies the guard is present.

```ts
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin/staff", () => ({
  requireStaff: async () => {
    throw new Error("Forbidden: staff access required")
  },
}))

import { listAllTeamsAction } from "./teams-actions"

describe("listAllTeamsAction", () => {
  it("requires staff", async () => {
    await expect(listAllTeamsAction()).rejects.toThrow(/staff/)
  })
})
```

- [ ] **Step 4: Run tests**

Run: `bunx turbo run test --filter=@superserve/console -- teams-actions`
Expected: PASS.

- [ ] **Step 5: Lint, format, commit**

```bash
bunx oxlint --fix && bunx oxfmt --write
git add apps/console/src/lib/admin/audit.ts apps/console/src/lib/admin/teams-actions.ts apps/console/src/lib/admin/teams-actions.test.ts
git commit -m "feat(console): admin team list + start/stop impersonation actions with audit"
```

---

### Task 9: Admin teams page (staff-gated)

**Files:**
- Create: `apps/console/src/app/(dashboard)/admin/page.tsx`
- Create: `apps/console/src/app/(dashboard)/admin/admin-teams-table.tsx`

**Interfaces:**
- Consumes: `requireStaff`, `isStaff`; `listAllTeamsAction`, `startImpersonationAction`.

- [ ] **Step 1: Read the existing page patterns** to match `PageHeader`/table styling and design tokens.

Read: `apps/console/src/app/(dashboard)/api-keys/page.tsx` and one table component under `apps/console/src/components/` for the dashed-border / mono-uppercase header conventions described in the project CLAUDE.md.

- [ ] **Step 2: Implement the page (server component)** — guard with `isStaff`, render the list with a per-row "Act as" form button.

```tsx
import { notFound } from "next/navigation"

import { isStaff } from "@/lib/admin/staff"
import { listAllTeamsAction, startImpersonationAction } from "@/lib/admin/teams-actions"
import { createServerClient } from "@/lib/supabase/server"

import { AdminTeamsTable } from "./admin-teams-table"

export default async function AdminPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!isStaff(user)) notFound()

  const teams = await listAllTeamsAction()
  return <AdminTeamsTable teams={teams} onActAs={startImpersonationAction} />
}
```

- [ ] **Step 3: Implement `admin-teams-table.tsx`** following the project's dashed-border / `font-mono uppercase text-xs` header style. Each row shows `name`, `active_sandbox_count / max_sandboxes`, `created_at`, and a submit button inside `<form action={() => onActAs(team.id)}>` labeled "Act as". Keep it a server component (it only renders forms calling the passed server action).

- [ ] **Step 4: Manual check**

Start the dev server (the user runs this), visit `/admin` as a staff user → the team list renders; as a non-staff user → 404.

- [ ] **Step 5: Lint, format, commit**

```bash
bunx oxlint --fix && bunx oxfmt --write
git add "apps/console/src/app/(dashboard)/admin/"
git commit -m "feat(console): add staff-gated admin teams page"
```

---

### Task 10: Impersonation banner + layout wiring + Admin nav

**Files:**
- Create: `apps/console/src/components/admin/impersonation-banner.tsx`
- Modify: `apps/console/src/app/(dashboard)/layout.tsx`
- Modify: `apps/console/src/components/sidebar/nav-config.tsx` (+ thread a `isStaff` flag through `dashboard-shell.tsx` / `sidebar.tsx`)

**Interfaces:**
- Consumes: `getImpersonationTeamId`, `stopImpersonationAction`, `isStaff`, `createAdminClient`.

- [ ] **Step 1: Add a context helper** to `impersonation.ts`: `getImpersonationContext()` returning `{ teamId, teamName } | null` (reads cookie team, looks up the team name via the admin client). Test: returns null when no cookie.

- [ ] **Step 2: Implement `impersonation-banner.tsx`** (server component)

```tsx
import { getImpersonationContext } from "@/lib/admin/impersonation"
import { stopImpersonationAction } from "@/lib/admin/teams-actions"

export async function ImpersonationBanner() {
  const ctx = await getImpersonationContext()
  if (!ctx) return null
  return (
    <div className="flex items-center justify-between gap-2 border-b border-dashed border-warning/40 bg-warning/10 px-4 py-2 font-mono text-xs uppercase tracking-tight text-warning">
      <span>Read-only — viewing team {ctx.teamName}</span>
      <form action={stopImpersonationAction}>
        <button type="submit" className="underline">
          Exit
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Wire the banner into the dashboard layout**

```tsx
import { ImpersonationBanner } from "@/components/admin/impersonation-banner"
import { DashboardShell } from "@/components/layout/dashboard-shell"
import { QueryProvider } from "@/components/query-provider"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ImpersonationBanner />
      <DashboardShell>{children}</DashboardShell>
    </QueryProvider>
  )
}
```

- [ ] **Step 4: Add a staff-only "Admin" nav entry.** Read `nav-config.tsx`, `dashboard-shell.tsx`, and `sidebar.tsx`. Add a `NavItem` (`{ href: "/admin", label: "Admin", icon: <a phosphor icon, weight light> }`) and render it only when staff. Compute `isStaff(user)` in the server layout/shell and pass a boolean down to the sidebar; append the Admin item to the rendered list when true. Follow the existing `NavItem` shape exactly.

- [ ] **Step 5: Manual check** — as staff with impersonation active, the warning banner shows with an Exit button that clears state and returns to `/admin`; the Admin nav entry is visible only to staff.

- [ ] **Step 6: Lint, format, commit**

```bash
bunx oxlint --fix && bunx oxfmt --write
git add apps/console/src/components/admin/ "apps/console/src/app/(dashboard)/layout.tsx" apps/console/src/components/sidebar/ apps/console/src/lib/admin/impersonation.ts
git commit -m "feat(console): impersonation banner and staff-only admin nav"
```

---

### Task 11: Env docs + full verification

**Files:**
- Modify: `apps/console/.env.example`

- [ ] **Step 1: Document the optional env vars** in `.env.example`

```bash
# Admin impersonation (optional)
# Domain whose Google-verified accounts are Superserve staff (default: superserve.ai)
STAFF_EMAIL_DOMAIN=superserve.ai
# Impersonation session length in minutes (default: 30)
IMPERSONATION_TTL_MINUTES=30
```

- [ ] **Step 2: Run the full console suite, typecheck, lint, format check**

```bash
bunx turbo run test --filter=@superserve/console
bunx turbo run typecheck --filter=@superserve/console
bunx oxlint && bunx oxfmt --check
```
Expected: all green.

- [ ] **Step 3: Manual end-to-end** (dev server run by the user) — verify the §8 checklist in the design doc: read-only browse works; POST/DELETE proxy → 403; no `activity` rows / no `active_sandbox_count` change for the target team (confirm via Supabase MCP `execute_sql` read); Slack/PostHog audit on start/stop; forged cookie → null team; non-staff → 404 on `/admin`.

- [ ] **Step 4: Commit**

```bash
git add apps/console/.env.example
git commit -m "docs(console): document admin impersonation env vars"
```

---

## Self-Review notes

- **Spec coverage:** D1 (no backend) → no `kathmandu/` tasks; D2 read-only → Tasks 6 (proxy) + 7 (actions); D3 no-usage → inherent in D2, verified in Task 11 step 3; D4 staff gate → Task 1; D5 cookie → Tasks 2–3; D6 key → Tasks 4–5; D7 audit → Task 8; UI → Tasks 9–10; env → Task 11.
- **Import cycle:** addressed in Task 4 by extracting `proxy-secret.ts`.
- **Escape-hatch:** `createApiKeyAction` block is in Task 7 Step 1 (critical).
- **Internal-key hiding:** Task 7 Step 1 filters both `__console_proxy__` and `__console_impersonation__`.
- **Type consistency:** `getImpersonationTeamId(user)`, `getAuthApiKeyForUser(user)`, `ensureImpersonationKeyRow(adminId, teamId, ttlMinutes?)`, `isStaff(user)`/`requireStaff()` used consistently across tasks.
- **Open UI detail:** `nav-config.tsx`, `dashboard-shell.tsx`, `sidebar.tsx` are read at the start of Task 10 because their exact shapes weren't captured during planning; the Admin-nav change is specified against the existing `NavItem` contract.
