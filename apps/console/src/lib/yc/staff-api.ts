import "server-only"
import { createHash, createPrivateKey, sign } from "node:crypto"

import { z } from "zod"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { isStaff } from "@/lib/admin/staff"
import { cellFor, configuredRegions, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

import {
  claimID,
  claimState,
  staffClaimSchema,
  staffDecisionSchema,
  type StaffDecision,
} from "./staff-schema"
import { verifyStaffSession } from "./staff-session"

export class StaffRequestError extends Error {
  constructor(public readonly kind: "forbidden" | "conflict" | "unavailable") {
    super(kind)
    this.name = "StaffRequestError"
  }
}

async function staffActor() {
  if (process.env.YC_STAFF_UI_ENABLED !== "true")
    throw new StaffRequestError("unavailable")
  const client = await createServerClient()
  const {
    data: { user },
    error,
  } = await client.auth.getUser()
  if (
    error ||
    !user ||
    !isStaff(user) ||
    !user.email_confirmed_at ||
    user.is_anonymous ||
    (await getImpersonationContext(user))
  )
    throw new StaffRequestError("forbidden")
  const { data, error: claimsError } = await client.auth.getClaims()
  const methods = data?.claims.amr
  if (
    claimsError ||
    data?.claims.sub !== user.id ||
    !Array.isArray(methods) ||
    !methods.some(
      (entry) => typeof entry === "object" && entry.method === "oauth",
    ) ||
    methods.some(
      (entry) =>
        typeof entry !== "object" || !["oauth", "totp"].includes(entry.method),
    )
  )
    throw new StaffRequestError("forbidden")
  try {
    await verifyStaffSession(user, data.claims.session_id)
  } catch {
    throw new StaffRequestError("forbidden")
  }
  return user.id
}

async function request(
  path: string,
  method: "GET" | "POST",
  body: string,
  region: string,
) {
  const actor = await staffActor()
  if (!configuredRegions().includes(region))
    throw new StaffRequestError("unavailable")
  const origin = new URL(cellFor(region).apiBaseUrl)
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new StaffRequestError("unavailable")
  const key = createPrivateKey(process.env.PROMOTION_ACCOUNT_PRIVATE_KEY ?? "")
  if (key.asymmetricKeyType !== "ed25519")
    throw new StaffRequestError("unavailable")
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", typ: "JWT" }),
  ).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      iss: "promotion-auth-adapter",
      aud: "yc-staff",
      sub: actor,
      iat: now,
      exp: now + 60,
      operation: method === "GET" ? "read" : "decision",
      method,
      path,
      body_sha256: createHash("sha256").update(body).digest("hex"),
      provider: "google",
      email_verified: true,
    }),
  ).toString("base64url")
  const input = `${header}.${payload}`
  let response
  try {
    response = await fetch(new URL(path, origin), {
      method,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        "X-YC-Staff-Assertion": `${input}.${sign(null, Buffer.from(input), key).toString("base64url")}`,
      },
      ...(method === "POST" ? { body } : {}),
    })
  } catch {
    throw new StaffRequestError("unavailable")
  }
  if (!response.ok)
    throw new StaffRequestError(
      response.status === 403
        ? "forbidden"
        : response.status === 409
          ? "conflict"
          : "unavailable",
    )
  return response.json()
}

export async function listStaffClaims(state = "manual_review", after?: string) {
  const query = new URLSearchParams({ state: claimState.parse(state) })
  if (after) query.set("after_id", claimID.parse(after))
  return z
    .object({ claims: z.array(staffClaimSchema) })
    .parse(
      await request(
        `/internal/yc/staff/claims?${query}`,
        "GET",
        "",
        DEFAULT_REGION,
      ),
    ).claims
}

export async function getStaffClaim(id: string) {
  return staffClaimSchema.parse(
    await request(
      `/internal/yc/staff/claims/${claimID.parse(id)}`,
      "GET",
      "",
      DEFAULT_REGION,
    ),
  )
}

export async function decideStaffClaim(input: StaffDecision, region: string) {
  const body = JSON.stringify(staffDecisionSchema.parse(input))
  // Home-region authorization and live read/write RBAC are rechecked by the API.
  return staffClaimSchema.parse(
    await request("/internal/yc/staff/claims/decision", "POST", body, region),
  )
}
