import crypto from "node:crypto"

import type { User } from "@supabase/supabase-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const io = vi.hoisted(() => ({
  getUser: vi.fn(),
  getApplicant: vi.fn(),
  updateApplicant: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  email: vi.fn(),
  cookie: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: io.getUser } }),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: io.from,
    rpc: io.rpc,
    auth: {
      admin: {
        getUserById: io.getApplicant,
        updateUserById: io.updateApplicant,
      },
    },
  }),
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: io.cookie,
    getAll: () => [],
    set: vi.fn(),
  }),
}))
vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("@/lib/posthog/actions", () => ({ trackEvent: vi.fn() }))
vi.mock("@/lib/email/send", () => ({ sendEmail: io.email }))

import {
  recoverPromotionTeam,
  recoverPromotionTeamForEnterprise,
} from "@/lib/api/promotion-device-evidence"
import { provisionHeldApplicantTeam } from "@/lib/api/team-provisioning"

import { assignEnterprisePlan } from "./enterprise-plan"
import {
  authorizeEnterpriseProvisioning,
  enterpriseProvisioningContext,
  type EnterpriseProvisioningAuthority,
} from "./enterprise-provisioning-authority"
import { signImpersonationToken } from "./impersonation"
import { approveSignup } from "./signup-approval"

const applicantId = "11111111-1111-4111-8111-111111111111"
const staffId = "22222222-2222-4222-8222-222222222222"
const version = "33333333-3333-4333-8333-333333333333"
const teamId = "44444444-4444-4444-8444-444444444444"
const attemptId = "55555555-5555-4555-8555-555555555555"
let applicant: User
let staff: User
let decision: Record<string, unknown> | null
let preparation: Record<string, unknown> | null
let loseCompletionReply: boolean
let loseAssignmentReply: boolean
let publicKey: crypto.KeyObject
let requests: { path: string; body: Record<string, unknown>; actor: string }[]
let assignments: Map<string, string>
let membershipRows: Map<string, Record<string, unknown>[]>

function db(table: string) {
  let action = "select"
  let payload: Record<string, unknown> = {}
  let singular = false
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    limit: () => query,
    single: () => {
      singular = true
      return query
    },
    maybeSingle: () => {
      singular = true
      return query
    },
    insert: (value: Record<string, unknown>) => {
      action = "insert"
      payload = value
      return query
    },
    upsert: (value: Record<string, unknown>) => {
      action = "upsert"
      payload = value
      return query
    },
    // Supabase's query builder intentionally implements PromiseLike at its I/O boundary.
    // oxlint-disable-next-line unicorn/no-thenable
    then: (resolve: (value: unknown) => unknown) => {
      if (table === "signup_review_decision") {
        if (action === "upsert")
          decision ??= { ...payload, created_at: "2026-10-26T00:00:00Z" }
        return Promise.resolve(resolve({ data: decision, error: null }))
      }
      if (table === "roles")
        return Promise.resolve(
          resolve({ data: { id: "owner-role" }, error: null }),
        )
      const rows = membershipRows.get(table) ?? []
      if (action === "insert") {
        if (rows.length)
          return Promise.resolve(
            resolve({ data: null, error: { code: "23505" } }),
          )
        rows.push(payload)
        membershipRows.set(table, rows)
      }
      return Promise.resolve(
        resolve({ data: singular ? (rows[0] ?? null) : rows, error: null }),
      )
    },
  }
  return query
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  applicant = {
    id: applicantId,
    aud: "authenticated",
    email: "held@example.com",
    email_confirmed_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-25T00:00:00Z",
    created_at: "2026-10-01T00:00:00Z",
    app_metadata: { provider: "email", signup_review: "pending" },
    user_metadata: {},
  } as User
  staff = {
    id: staffId,
    aud: "authenticated",
    created_at: "2026-10-01T00:00:00Z",
    user_metadata: {},
    email: "operator@superserve.ai",
    app_metadata: {
      provider: "google",
      permissions: [
        "platform:signups:approve",
        "platform:billing:read",
        "platform:billing:write",
      ],
    },
  } as User
  decision = null
  preparation = null
  requests = []
  assignments = new Map()
  membershipRows = new Map()
  loseCompletionReply = false
  loseAssignmentReply = false
  io.getUser.mockReset().mockImplementation(async () => ({
    data: { user: structuredClone(staff) },
    error: null,
  }))
  io.getApplicant.mockReset().mockImplementation(async (id) => ({
    data: { user: id === applicantId ? structuredClone(applicant) : null },
    error: null,
  }))
  io.updateApplicant.mockReset().mockImplementation(async (_id, value) => {
    Object.assign(applicant.app_metadata, value.app_metadata)
    return { error: null }
  })
  io.from.mockReset().mockImplementation(db)
  io.rpc.mockReset().mockResolvedValue({
    data: [
      {
        outcome: "applied",
        evidence_version: "66666666-6666-4666-8666-666666666666",
      },
    ],
    error: null,
  })
  io.email.mockReset().mockResolvedValue({ success: true })
  io.cookie.mockReset().mockReturnValue(undefined)
  vi.stubEnv(
    "CONSOLE_PROXY_SECRET",
    "test-only-proxy-secret-with-more-than32characters",
  )
  const keys = crypto.generateKeyPairSync("ed25519")
  publicKey = keys.publicKey
  vi.stubEnv(
    "PROMOTION_ACCOUNT_PRIVATE_KEY",
    keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  )
  vi.stubEnv("PROMOTION_CAPTURE_TOKEN", "test-capture")
  vi.stubEnv("PROMOTION_ACCOUNT_TOKEN", "test-account")
  vi.stubEnv("INTERNAL_API_TOKEN", "test-internal")
  vi.stubEnv("OPERATOR_API_TOKEN", "test-operator")
  vi.stubEnv("SANDBOX_API_URL", "http://enterprise-backend.test")
  vi.stubEnv("SUPABASE_USWEST_URL", "")
  vi.stubEnv(
    "GOOGLE_SIGNUP_PROOF_SECRET",
    "test-only-proof-secret-with-more-than32characters",
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      const headers = new Headers(init?.headers)
      const actor = headers.get("X-Actor-User-Id") ?? ""
      requests.push({ path, body, actor })
      if (path === "/internal/billing/catalog")
        return json({
          plans: [
            {
              id: version,
              display_name: "Enterprise",
              pricing_version: "v2",
              kind: "custom",
              state: "published",
              self_serve: false,
              display_only: false,
              monthly_fee_cents: null,
              annual_fee_cents: null,
            },
          ],
        })
      if (path.endsWith("/plan-assignments")) {
        expect(actor).toBe(staffId)
        expect(headers.get("Authorization")).toBe("Bearer test-operator")
        expect(applicant.app_metadata.signup_review).toBe("pending")
        const key = body.idempotency_key
        expect(assignments.get(key) ?? body.version_id).toBe(body.version_id)
        assignments.set(key, body.version_id)
        if (loseAssignmentReply) {
          loseAssignmentReply = false
          throw new Error("assignment reply lost")
        }
        return json({ id: "assignment" })
      }
      const operation = path.split("/").at(-1)
      const assertion = headers.get("X-Promotion-Account-Assertion")!
      const [head, content, signature] = assertion.split(".")
      expect(
        crypto.verify(
          null,
          Buffer.from(`${head}.${content}`),
          publicKey,
          Buffer.from(signature, "base64url"),
        ),
      ).toBe(true)
      const claims = JSON.parse(Buffer.from(content, "base64url").toString())
      expect(claims).toMatchObject({
        sub: applicantId,
        operation,
        iss: "promotion-auth-adapter",
        aud: "promotion-account",
      })
      expect(actor).toBe(applicantId)
      expect(body.user_id).toBe(applicantId)
      expect(headers.get("Authorization")).toBe("Bearer test-account")
      if (operation === "evidence")
        return json({
          attempt_id: attemptId,
          event_id: "event",
          fingerprint: "fingerprint",
          event_at: "2026-10-01T00:00:00Z",
          bound_at: "2026-10-01T00:00:00Z",
        })
      if (operation === "register") return json({ outcome: "owner" })
      for (const field of [
        "operation_id",
        "home_region",
        "name",
        "authority_unavailable",
        "attempt_id",
        "team_id",
      ])
        if (field in body) expect(claims[field]).toBe(body[field])
      expect(body.operation_id).toBe(applicantId)
      expect(body.home_region).toBe("use")
      if (operation === "recover-team")
        return preparation
          ? json(preparation)
          : json({ error: { code: "creation_missing" } }, 404)
      if (operation === "prepare-team") {
        preparation ??= {
          ...body,
          team_id: teamId,
          attempt_id: attemptId,
          state: "prepared",
          outcome: null,
          reason: null,
          created_at: "2026-10-26T00:00:00Z",
        }
        return json(preparation)
      }
      if (operation === "complete-team") {
        preparation = {
          ...preparation!,
          state: "completed",
          outcome: "granted",
          reason: "eligible",
        }
        if (loseCompletionReply) {
          loseCompletionReply = false
          throw new Error("completion reply lost")
        }
        return json(preparation)
      }
      throw new Error(`Unexpected request ${path}`)
    }),
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
const approve = () =>
  approveSignup(applicantId, staffId, version, (team, frozenVersion) =>
    assignEnterprisePlan(team, applicantId, frozenVersion),
  )

describe("real staff-to-applicant Enterprise fulfillment callgraph", () => {
  it("uses the real signed promotion helpers with a distinct eligible staff session", async () => {
    expect(staffId).not.toBe(applicantId)
    await expect(approve()).resolves.toEqual({ ok: true, outcome: "approved" })
    expect(
      requests.filter((r) => r.path.endsWith("/prepare-team")),
    ).toHaveLength(1)
    expect(assignments.size).toBe(1)
    expect(applicant.app_metadata.signup_review).toBe("approved")
    expect(io.email).toHaveBeenCalledOnce()
  })
  it.each(["completion", "assignment"])(
    "recovers one stable team and assignment after a lost %s response and concurrent same-choice retries",
    async (lost) => {
      loseCompletionReply = lost === "completion"
      loseAssignmentReply = lost === "assignment"
      await expect(approve()).rejects.toThrow()
      expect(applicant.app_metadata.signup_review).toBe("pending")
      const results = await Promise.allSettled([approve(), approve()])
      expect(results.some((r) => r.status === "fulfilled" && r.value.ok)).toBe(
        true,
      )
      expect(
        requests.filter((r) => r.path.endsWith("/prepare-team")),
      ).toHaveLength(1)
      expect(preparation?.team_id).toBe(teamId)
      expect(assignments.size).toBe(1)
      expect([...assignments.values()]).toEqual([version])
      expect(applicant.app_metadata.signup_review).toBe("approved")
    },
  )
  it("retains the self-service applicant-session requirement", async () => {
    await expect(
      recoverPromotionTeam({
        userId: applicantId,
        region: "use",
        operationId: applicantId,
      }),
    ).rejects.toThrow("forbidden")
    expect(requests).toEqual([])
  })
  it.each(["permissions", "decision", "plan"])(
    "denies delegated provisioning for mismatched %s before transport",
    async (invalid) => {
      decision = {
        user_id: applicantId,
        decision: "approved",
        plan_version_id: version,
        region: "use",
      }
      if (invalid === "permissions") staff.app_metadata.permissions = []
      if (invalid === "decision") decision.decision = "rejected"
      if (invalid === "plan") decision.plan_version_id = "other-plan"
      await expect(
        provisionHeldApplicantTeam(applicant, "use", version),
      ).rejects.toThrow()
      expect(requests).toEqual([])
      expect(io.rpc).not.toHaveBeenCalled()
      expect(io.updateApplicant).not.toHaveBeenCalled()
    },
  )
  it("blocks eligible staff during read-only impersonation", async () => {
    decision = {
      user_id: applicantId,
      decision: "approved",
      plan_version_id: version,
      region: "use",
    }
    io.cookie.mockReturnValue({
      value: signImpersonationToken(teamId, Date.now() + 60_000),
    })
    await expect(
      provisionHeldApplicantTeam(applicant, "use", version),
    ).rejects.toThrow("authority required")
    expect(requests).toEqual([])
    expect(io.rpc).not.toHaveBeenCalled()
  })
  it("rejects forged capabilities and tuple changes", async () => {
    const locator = {
      userId: applicantId,
      region: "use",
      operationId: applicantId,
    }
    await expect(
      recoverPromotionTeamForEnterprise(
        locator,
        {} as EnterpriseProvisioningAuthority,
      ),
    ).rejects.toThrow("binding mismatch")
    decision = {
      user_id: applicantId,
      decision: "approved",
      plan_version_id: version,
      region: "use",
    }
    const authority = await authorizeEnterpriseProvisioning(
      applicantId,
      "use",
      version,
    )
    expect(() => enterpriseProvisioningContext(authority, staffId)).toThrow(
      "binding mismatch",
    )
    expect(() =>
      enterpriseProvisioningContext(authority, applicantId, "usw"),
    ).toThrow("binding mismatch")
    await expect(
      recoverPromotionTeamForEnterprise(
        { ...locator, operationId: staffId },
        authority,
      ),
    ).rejects.toThrow("binding mismatch")
    expect(requests).toEqual([])
  })
})
