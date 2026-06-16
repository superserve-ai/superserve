# Admin Team Impersonation (Read-Only) — Design

> **Ticket:** SS-64 — Admin view for access to all accounts
> **Status:** Approved design, ready to plan
> **Date:** 2026-06-17
> **Scope:** `apps/console/` only. No sandbox/backend (Go) code changes.
> **Companion:** `2026-06-17-admin-impersonation-plan.md` (implementation plan)

## 1. Problem & Goal

Superserve staff need to "switch into" any customer team from the console to
view that team's account (sandboxes, activity, snapshots, API-key metadata)
for support and debugging.

**Goal:** A staff member, logged in with their own Google account, can pick any
team and browse it **read-only**, with that traffic **not counted toward the
customer's usage or quota**, and every impersonation attributed to the
individual staff member.

**Non-goal (v1):** Performing writes as the customer (create/pause/resume/delete
sandboxes, exec, file writes, key management).

## 2. How auth & tenancy work today (verified)

- **Backend trusts `api_key.team_id` blindly.** The Go auth middleware
  (`kathmandu/internal/api/middleware.go:36`) runs
  `SELECT id, team_id, created_by FROM api_key WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
  and scopes every query by that `team_id`. There is **no** acting-as header,
  **no** re-check that the key's creator belongs to the team, and the middleware
  does **not** read `scopes`.
- **The console mints the keys.** The browser never holds a platform key; the
  proxy (`apps/console/src/app/api/[...path]/route.ts`) injects a server-side
  `X-API-Key` derived per user (`apps/console/src/lib/api/proxy-auth.ts`,
  `deriveRawKey` = HMAC(`CONSOLE_PROXY_SECRET`, `v1:<userId>`)) whose `api_key`
  row points at the user's own team.
- **Server actions read Supabase directly.** Activity, snapshots, and API-key
  metadata are read with the **service-role** admin client, scoped by `team_id`
  (`*-actions.ts`). These never touch the backend or quota.
- **All usage/quota writes are write-triggered:**
  - `activity` rows are inserted only on mutations — exec, sandbox
    start/pause/resume/delete, network/metadata update, template build
    (`handlers.go`, `streaming.go`, `handlers_template.go`). **No GET logs
    activity.**
  - Quota (`team.active_sandbox_count`) is moved only by the sandbox
    `INSERT`/`UPDATE`/`DELETE` triggers (`supabase/migrations/20260513000001_sandbox_quota_counter.sql`).
  - `proxy_audit` / `net_flow` are **data-plane** telemetry (sandbox network
    proxy / egress), not written by control-plane reads.
- **Live schema confirms:** `scopes` is empty on all 28 `api_key` rows;
  `expires_at` is unused but supported and enforced by the backend; `profile`
  has `provider`/`provider_id` but **no** staff/admin column;
  `team_member.role` only ever holds `'owner'`. RLS is enabled on every table,
  **but the console uses the `service_role` client, which bypasses RLS** — so
  the console's own checks are the entire security boundary.

## 3. Key decisions

### D1 — Console-only, no backend changes
Because isolation rests on the console-written `api_key.team_id`, "act as team
T" is achieved by forwarding an `X-API-Key` whose row points at T. The Go
service cannot distinguish it from the customer. **No sandbox changes.**

### D2 — Read-only enforced in the console (not via scopes)
`api_key.scopes` is not enforced by the backend, so a scope-based read-only key
would require backend work. Instead we enforce read-only at the **only two
places the browser can reach the platform**:
1. **Proxy** — while impersonating, forward only `GET`/`HEAD`; reject other
   methods with `403`.
2. **Mutating server actions** — refuse while impersonating.

Because the impersonation key is minted server-side and **never sent to the
browser**, the admin cannot bypass the proxy. The one escape hatch —
`createApiKeyAction` minting a real full-power key for team T — is explicitly
blocked.

### D3 — No usage/quota impact (falls out of read-only)
Every quota/activity/billing artifact is write-triggered (§2). Read-only blocks
every write, so impersonation produces **zero** `activity` rows, **zero** quota
movement, and **zero** metered compute under the customer's `team_id`. Nothing
to exempt.

### D4 — Admin identity: Google-verified `@superserve.ai`, behind one seam
A user is staff iff their email is on the staff domain **and** the identity is
Google (`app_metadata.provider`/`providers` includes `google`) — never a raw
email-string match, because email/password signup exists and `@superserve.ai`
could otherwise be spoofed. We are a 4-engineer team where everyone is an admin,
so a hand-maintained allowlist would be the same set with more overhead;
domain-gated SSO also gives **instant revocation via Google Workspace
offboarding** with no redeploy.

The check lives in **one function, `isStaff(user)`** (+ `requireStaff()`), so the
source of truth can later move env→DB-flag→Google-Group-via-SSO as a
single-function change. Staff domain is configurable via `STAFF_EMAIL_DOMAIN`
(default `superserve.ai`).

### D5 — Impersonation context: signed, HttpOnly, short-TTL cookie
"Act as team T" sets cookie `ss_impersonate` = `teamId.exp.HMAC(secret, "teamId.exp")`
(HttpOnly, Secure in prod, SameSite=Lax, ~30-min TTL, signed with
`CONSOLE_PROXY_SECRET`). It is tamper-proof and self-expiring. Reading it grants
the target team **only when `isStaff(user)` is also true** — the cookie alone is
never sufficient.

### D6 — Impersonation key: ephemeral, per-(admin, team)
While impersonating, the proxy injects `deriveImpersonationKey(adminId, teamId)`
= HMAC(secret, `imp:v1:<adminId>:<teamId>`) and upserts a hidden `api_key` row
`{ team_id: T, name: "__console_impersonation__", created_by: <admin>, scopes: [],
expires_at: now()+TTL, revoked_at: null }`, refreshing `expires_at` on each use.
Per-(admin, team) keeps platform attribution (`created_by`) tied to the
individual and self-expires via the backend's `expires_at` check. The row is
hidden from the customer's key list by name, and revoked on explicit "exit".

### D7 — Audit: per-individual, console-side
Every start/stop is logged with the **individual** admin's email + team:
structured server log + Slack webhook (`sendToSlackHook`) + PostHog event. This
is the accountability artifact a shared password would destroy. A durable
`admin_audit` table is a documented fast-follow (one migration in the backend
repo; no Go code reads it).

## 4. Mechanism / request flows

**Control-plane read while impersonating** (e.g. `GET /api/sandboxes`):
1. Proxy resolves `user` → `getImpersonationTeamId(user)` returns T (staff + valid cookie).
2. Method is `GET` → allowed. (`POST`/`DELETE`/… → `403 read_only_impersonation`.)
3. `getAuthApiKeyForUser(user)` mints/refreshes the impersonation key for T and injects it.
4. Backend resolves the key → team T, returns T's data. No activity/quota write.

**Server-action read while impersonating** (activity/snapshots/key list):
- The action resolves `getImpersonationTeamId(user) ?? ownTeam` and queries
  Supabase scoped to T via the service-role client. Internal key names
  (`__console_proxy__`, `__console_impersonation__`) are filtered from the list.

**Write while impersonating** (blocked):
- Proxy: non-GET → `403`. Mutating server actions (`createApiKeyAction`,
  `revokeApiKeyAction`, …): throw "read-only while viewing another team".

**Not impersonating:** behavior is byte-for-byte unchanged (own-team key, own-team reads).

## 5. Security model

- **The console is the entire boundary** (service-role bypasses RLS). The
  quality of `isStaff` + the signed cookie *is* the security of the feature.
- **No browser-held credential:** the impersonation key is injected server-side,
  never returned; the admin's only path is the proxy, which is GET-gated.
- **Escape hatch closed:** `createApiKeyAction` is blocked while impersonating,
  so an admin cannot mint a real key to use outside the proxy.
- **Cookie integrity:** HMAC-signed + expiry; tamper or expiry → ignored. Cookie
  presence without staff status → ignored.
- **Defense in depth:** key carries `expires_at`; revoked on exit.
- **Data-plane boundary:** v1 is control-plane + Supabase reads only. Surfacing a
  running sandbox's files/terminal (data plane) would log to `proxy_audit` under
  the customer's `team_id` and is **out of scope** for v1.

## 6. Data model

**No schema change required.** Uses existing `api_key` columns
(`team_id, key_hash, name, scopes, created_by, expires_at, revoked_at`). The
optional `admin_audit` table (D7 fast-follow) would be a backend-repo migration,
read by no Go code.

## 7. Out of scope / future

- Write impersonation, and quota exemption for it (needs backend quota work).
- Backend `scopes` enforcement (defense-in-depth read-only at the platform).
- Google Group via SSO for staff membership (SAML group mapping / Directory API /
  auth hook) — the `isStaff` seam is built to swap to this.
- Durable `admin_audit` table.
- Data-plane viewing (sandbox files/terminal) while impersonating.

## 8. Verification

- Unit (Vitest): `isStaff` matrix; cookie sign/verify (tamper, expiry);
  `getImpersonationTeamId` (staff×cookie matrix); key determinism; proxy
  GET-only gate; server-action write guards; internal-key filtering.
- Manual: as staff, impersonate a team → see its sandboxes/activity read-only;
  confirm POST/DELETE proxy calls return 403; confirm no `activity` rows and no
  `active_sandbox_count` change for the target team; confirm Slack/PostHog audit
  on start/stop; confirm a non-staff user gets 404 on `/admin` and null team on a
  forged cookie.
