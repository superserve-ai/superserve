import type { User } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import {
  checkoutAssertion,
  readCheckoutIntent,
  signCheckoutIntent,
  validOperationId,
} from "@/lib/api/checkout-intent"
import { publishAccountPromotion } from "@/lib/api/promotion-publication"
import {
  getAuthApiKeyAndTeamForRecovery,
  getAuthApiKeyAndTeamForUser,
  getAuthApiKeyForUser,
  repairRecoveryAuthApiKeyForTeam,
} from "@/lib/api/proxy-auth"
import { redactAccessTokens } from "@/lib/api/redact"
import type { TeamMembership } from "@/lib/api/team-directory"
import { GoogleSignupRecoveryRequiredError } from "@/lib/auth/google-signup-proof"
import {
  SignupRestrictedError,
  SIGNUP_RESTRICTED_MESSAGE,
} from "@/lib/auth/signup-restrictions"
import {
  isSignupReviewBlocked,
  SIGNUP_REVIEW_PENDING_MESSAGE,
} from "@/lib/auth/signup-review"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL ?? "https://api.superserve.ai"

const ALLOWED_PREFIXES = [
  "sandboxes",
  "activity",
  "health",
  "v1",
  "templates",
  "secrets",
  "snapshots",
  "providers",
  "billing/summary",
  "billing/pricing",
  "billing/usage-series",
]

const BILLING_V2_READ_PATHS = new Set([
  "billing/plans/public",
  "billing/plan",
  "billing/free-allowance",
  "billing/prepaid",
])

function isBillingV2ReadPath(path: string): boolean {
  return (
    BILLING_V2_READ_PATHS.has(path) || path === "billing/plan-change-preview"
  )
}

function isPlanChangeWritePath(path: string): boolean {
  return (
    path === "billing/plan-changes" ||
    /^billing\/plan-changes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/undo$/i.test(
      path,
    )
  )
}

function isTeamBillingPath(path: string): boolean {
  return (
    /^teams\/[^/]+\/billing\/usage$/.test(path) ||
    /^teams\/[^/]+\/billing\/periods$/.test(path) ||
    /^teams\/[^/]+\/billing\/periods\/[^/]+\/export-preview$/.test(path)
  )
}

function isStripeBillingPath(path: string): boolean {
  return (
    path === "stripe/checkout-session" ||
    path === "stripe/customer-portal-session" ||
    isPlanBillingPath(path)
  )
}

const PREPAID_BILLING_METHODS: Record<string, string> = {
  "billing/prepaid": "GET",
  "billing/prepaid/checkout": "POST",
  "billing/prepaid/auto-recharge": "PUT",
}

const PREPAID_WRITE_FIELDS: Record<string, string[]> = {
  "billing/prepaid/checkout": [
    "operation_id",
    "amount_cents",
    "success_url",
    "cancel_url",
  ],
  "billing/prepaid/auto-recharge": [
    "enabled",
    "threshold_cents",
    "amount_cents",
  ],
}

function isPrepaidBillingPath(path: string): boolean {
  return Object.hasOwn(PREPAID_BILLING_METHODS, path)
}

function isPrepaidBillingWrite(path: string): boolean {
  return isPrepaidBillingPath(path) && PREPAID_BILLING_METHODS[path] !== "GET"
}

function isPlanBillingPath(path: string): boolean {
  return [
    "stripe/pro-checkout",
    "stripe/pro-checkout/recover",
    "stripe/plan-choice",
  ].includes(path)
}

/** Paths that carry their own auth (e.g. Bearer token). */
const SKIP_KEY_INJECTION = ["v1/auth/"]

/**
 * Only these request headers are forwarded upstream. Everything else
 * (cookies, client-supplied x-api-key, etc.) is stripped so a malicious or
 * buggy client can't leak console cookies to the sandbox API or override the
 * server-injected key.
 */
const FORWARD_REQUEST_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "authorization",
  "content-length",
  "content-type",
  "idempotency-key",
  "user-agent",
])

function isAllowedPath(path: string): boolean {
  if (isBillingV2ReadPath(path) || isPlanChangeWritePath(path)) return true
  if (isTeamBillingPath(path)) return true
  if (isStripeBillingPath(path)) return true
  if (isPrepaidBillingPath(path)) return true
  return ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )
}

function hasUnsafePathSegment(path: string[]): boolean {
  return path.some((segment) => {
    let decoded = segment
    for (let depth = 0; depth < 8; depth++) {
      if (
        decoded === "." ||
        decoded === ".." ||
        /[\\?#/\u0000-\u001f\u007f]/.test(decoded)
      ) {
        return true
      }
      if (!decoded.includes("%")) return false
      try {
        decoded = decodeURIComponent(decoded)
      } catch {
        return true
      }
    }
    return true
  })
}

function signupReviewPendingResponse() {
  return NextResponse.json(
    {
      error: {
        code: "signup_review_pending",
        message: SIGNUP_REVIEW_PENDING_MESSAGE,
      },
      detail: SIGNUP_REVIEW_PENDING_MESSAGE,
    },
    { status: 403 },
  )
}

function shouldSkipKeyInjection(path: string): boolean {
  return SKIP_KEY_INJECTION.some((prefix) => path.startsWith(prefix))
}

function setImpersonationDebugHeaders(
  headers: Headers,
  debugEnabled: boolean,
  authMode: string,
  impersonatedTeamId: string | null,
): void {
  if (!debugEnabled) return
  headers.set("x-console-auth-mode", authMode)
  headers.set("x-console-impersonating", impersonatedTeamId ? "true" : "false")
  headers.set("x-console-impersonated-team", impersonatedTeamId ?? "")
}

function validPaymentReturn(
  value: unknown,
  origin: string,
  path: string,
): boolean {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    return (
      url.origin === origin &&
      !url.username &&
      !url.password &&
      url.pathname.replace(/\/$/, "") === path
    )
  } catch {
    return false
  }
}

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params
  const joinedPath = path.join("/")

  if (hasUnsafePathSegment(path) || !isAllowedPath(joinedPath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const skipKeyInjection = shouldSkipKeyInjection(joinedPath)
  const planRequest = isPlanBillingPath(joinedPath)
  if (planRequest && request.method !== "POST")
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 })
  if (
    isPrepaidBillingPath(joinedPath) &&
    request.method !== PREPAID_BILLING_METHODS[joinedPath]
  )
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 })
  const prepaidWrite = isPrepaidBillingWrite(joinedPath)
  if (isBillingV2ReadPath(joinedPath) && request.method !== "GET")
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 })
  if (isPlanChangeWritePath(joinedPath) && request.method !== "POST")
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 })
  const checkoutRequest =
    joinedPath === "stripe/checkout-session" && request.method === "POST"
  const debugImpersonation =
    request.nextUrl.searchParams.get("__debug_impersonation") === "1"
  let user: User | null = null
  let authObservedAt: string | null = null
  let impersonationContext: { teamId: string; region: string } | null = null
  let impersonating = false

  const bearer = request.headers
    .get("authorization")
    ?.match(/^bearer\s+(\S+)$/i)
  if (skipKeyInjection && bearer) {
    try {
      const supabase = await createServerClient()
      const { data, error } = await supabase.auth.getUser(bearer[1])
      if (error?.code === "bad_jwt")
        return NextResponse.json(
          { error: "Invalid bearer token" },
          { status: 401 },
        )
      if (error || !data?.user) throw new Error("Bearer lookup unavailable")
      if (isSignupReviewBlocked(data.user)) return signupReviewPendingResponse()
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "authentication_unavailable",
            message: "Authentication is temporarily unavailable. Please retry.",
          },
        },
        { status: 503, headers: { "retry-after": "5" } },
      )
    }
  }

  if (!skipKeyInjection) {
    const supabase = await createServerClient()
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()
    user = authUser
    if (isSignupReviewBlocked(user)) return signupReviewPendingResponse()
    authObservedAt = new Date().toISOString()
    impersonationContext = await getImpersonationContext(user)
    impersonating = impersonationContext !== null
    const isReadMethod = request.method === "GET" || request.method === "HEAD"
    if (impersonating && !isReadMethod) {
      return NextResponse.json(
        {
          error: {
            code: "read_only_impersonation",
            message:
              "Write operations are disabled while viewing another team.",
          },
        },
        { status: 403 },
      )
    }
  }

  const url = new URL(`${SANDBOX_API_URL}/${joinedPath}`)
  url.search = request.nextUrl.search
  url.searchParams.delete("__debug_impersonation")
  if (impersonating && impersonationContext) {
    url.searchParams.set("team_id", impersonationContext.teamId)
  }

  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    const lowerKey = key.toLowerCase()
    if (!skipKeyInjection && lowerKey === "authorization") {
      continue
    }
    if (FORWARD_REQUEST_HEADERS.has(lowerKey)) {
      headers.set(lowerKey, value)
    }
  }

  // Paths that carry their own auth (no key injection) go to the default
  // cell; authenticated requests go to the user's team's home cell.
  let apiBaseUrl = cellFor(DEFAULT_REGION).apiBaseUrl
  let teamRegion: string | null = null
  let checkoutTeam: TeamMembership | null = null

  // Inject server-side API key for authenticated requests
  let authMode = skipKeyInjection ? "skipped" : "none"
  if (!skipKeyInjection) {
    if (!user) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Not authenticated" } },
        { status: 401 },
      )
    }
    let selfContext: Awaited<
      ReturnType<typeof getAuthApiKeyAndTeamForUser>
    > | null = null
    let apiKey: string | null | undefined
    try {
      if (!impersonationContext) {
        if (checkoutRequest) {
          try {
            selfContext = await getAuthApiKeyAndTeamForRecovery(
              user,
              authObservedAt ?? undefined,
            )
          } catch {
            return NextResponse.json(
              {
                error: {
                  code: "service_unavailable",
                  message: "Checkout membership unavailable; please retry",
                },
              },
              { status: 503 },
            )
          }
        } else {
          selfContext = await getAuthApiKeyAndTeamForUser(
            user,
            authObservedAt ?? undefined,
          )
        }
      }
      if (
        checkoutRequest ||
        planRequest ||
        prepaidWrite ||
        isPlanChangeWritePath(joinedPath) ||
        joinedPath === "billing/plan-change-preview"
      )
        checkoutTeam = selfContext?.team ?? null
      apiKey = impersonationContext
        ? await getAuthApiKeyForUser(
            user,
            impersonationContext,
            authObservedAt ?? undefined,
          )
        : selfContext?.apiKey
    } catch (error) {
      if (error instanceof GoogleSignupRecoveryRequiredError)
        return NextResponse.json(
          {
            error: {
              code: "google_signup_recovery_required",
              message: error.message,
            },
          },
          { status: 403 },
        )
      if (error instanceof SignupRestrictedError)
        return NextResponse.json(
          {
            error: {
              code: "signup_blocked",
              message: SIGNUP_RESTRICTED_MESSAGE,
            },
          },
          { status: 403 },
        )
      throw error
    }
    if (!apiKey) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Not authenticated" } },
        { status: 401 },
      )
    }
    headers.set("X-API-Key", apiKey)
    teamRegion =
      impersonationContext?.region ?? selfContext?.team.region ?? null
    if (!teamRegion) throw new Error("Proxy team region unavailable")
    apiBaseUrl = cellFor(teamRegion).apiBaseUrl
    authMode = impersonating ? "impersonation" : "self"
  }

  const upstreamUrl = new URL(`${apiBaseUrl}/${joinedPath}`)
  upstreamUrl.search = url.search

  let body: ArrayBuffer | string | undefined =
    request.method !== "GET" && request.method !== "HEAD"
      ? await request.arrayBuffer()
      : undefined

  if (prepaidWrite) {
    let input: unknown
    try {
      input = JSON.parse(new TextDecoder().decode(body as ArrayBuffer))
    } catch {
      input = null
    }
    if (
      !checkoutTeam ||
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      (input as Record<string, unknown>).expected_team !==
        `${checkoutTeam.region}:${checkoutTeam.teamId}`
    ) {
      return NextResponse.json(
        {
          error: {
            code: "plan_team_changed",
            message: "Your active team changed. Reload to continue.",
          },
        },
        { status: 409 },
      )
    }
    const purchase = input as Record<string, unknown>
    if (
      joinedPath === "billing/prepaid/checkout" &&
      (!validPaymentReturn(
        purchase.success_url,
        request.nextUrl.origin,
        "/plan-usage/buy-credit",
      ) ||
        !validPaymentReturn(
          purchase.cancel_url,
          request.nextUrl.origin,
          "/plan-usage/buy-credit",
        ))
    ) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "Invalid payment return URL",
          },
        },
        { status: 400 },
      )
    }
    if (
      joinedPath === "billing/prepaid/checkout" &&
      purchase.operation_id !== undefined &&
      !validOperationId(purchase.operation_id)
    )
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "Invalid purchase operation",
          },
        },
        { status: 400 },
      )
    const fields = PREPAID_WRITE_FIELDS[joinedPath] ?? []
    body = JSON.stringify(
      Object.fromEntries(
        fields
          .filter((field) => field in (input as Record<string, unknown>))
          .map((field) => [field, (input as Record<string, unknown>)[field]]),
      ),
    )
  }

  if (joinedPath === "billing/plan-change-preview") {
    if (
      !checkoutTeam ||
      request.nextUrl.searchParams.get("expected_team") !==
        `${checkoutTeam.region}:${checkoutTeam.teamId}`
    ) {
      return NextResponse.json(
        {
          error: {
            code: "plan_team_changed",
            message: "Your active team changed. Reload to continue.",
          },
        },
        { status: 409 },
      )
    }
    upstreamUrl.searchParams.delete("expected_team")
  }

  if (isPlanChangeWritePath(joinedPath)) {
    let input: Record<string, unknown>
    try {
      input = JSON.parse(new TextDecoder().decode(body as ArrayBuffer))
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("Invalid request")
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "Invalid plan change request",
          },
        },
        { status: 400 },
      )
    }
    if (
      !checkoutTeam ||
      input.expected_team !== `${checkoutTeam.region}:${checkoutTeam.teamId}`
    ) {
      return NextResponse.json(
        {
          error: {
            code: "plan_team_changed",
            message: "Your active team changed. Reload to continue.",
          },
        },
        { status: 409 },
      )
    }
    body =
      joinedPath === "billing/plan-changes"
        ? JSON.stringify({
            target_plan: input.target_plan,
            idempotency_key: input.idempotency_key,
            preview_token: input.preview_token,
            expected_effective_at: input.expected_effective_at,
            confirm_pauses_running: input.confirm_pauses_running,
            ...(typeof input.reason === "string"
              ? { reason: input.reason }
              : {}),
          })
        : "{}"
    headers.delete("content-length")
    headers.set("content-type", "application/json")
  }

  if (planRequest) {
    let input: Record<string, unknown>
    try {
      input = JSON.parse(new TextDecoder().decode(body as ArrayBuffer))
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("Invalid request")
    } catch {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Invalid plan request" } },
        { status: 400 },
      )
    }
    if (
      !checkoutTeam ||
      input.expected_team !== `${checkoutTeam.region}:${checkoutTeam.teamId}`
    ) {
      return NextResponse.json(
        {
          error: {
            code: "plan_team_changed",
            message: "Your active team changed. Reload to continue.",
          },
        },
        { status: 409 },
      )
    }
    if (joinedPath === "stripe/pro-checkout") {
      if (!["pro_monthly", "pro_annual"].includes(input.offer as string))
        return NextResponse.json(
          {
            error: {
              code: "invalid_offer",
              message: "Select a Pro billing frequency",
            },
          },
          { status: 400 },
        )
      const validReturn = (value: unknown) => {
        try {
          const url = new URL(value as string)
          return (
            url.origin === request.nextUrl.origin &&
            !url.username &&
            !url.password &&
            (url.pathname.replace(/\/$/, "") === "/onboarding/plan" ||
              (url.pathname.replace(/\/$/, "") === "/billing/pro" &&
                url.searchParams.get("team") === input.expected_team))
          )
        } catch {
          return false
        }
      }
      if (!validReturn(input.success_url) || !validReturn(input.cancel_url))
        return NextResponse.json(
          {
            error: {
              code: "invalid_request",
              message: "Invalid payment return URL",
            },
          },
          { status: 400 },
        )
      upstreamUrl.pathname = "/stripe/checkout-session"
      body = JSON.stringify({
        offer: input.offer,
        operation_id: input.operation_id,
        success_url: input.success_url,
        cancel_url: input.cancel_url,
      })
    } else if (joinedPath === "stripe/plan-choice") {
      if (input.offer !== "free")
        return NextResponse.json(
          {
            error: {
              code: "invalid_offer",
              message: "Select Free to continue",
            },
          },
          { status: 400 },
        )
      body = JSON.stringify({ offer: "free" })
    } else {
      if (typeof input.restart !== "boolean")
        return NextResponse.json(
          {
            error: {
              code: "invalid_request",
              message: "Invalid recovery request",
            },
          },
          { status: 400 },
        )
      body = JSON.stringify({ restart: input.restart })
    }
    upstreamUrl.search = ""
  }

  // Recovery is checked first. Only its specific unavailable outcome can
  // proceed to fresh publication and a new Checkout generation.
  if (checkoutRequest) {
    if (!user || !authObservedAt) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Not authenticated" } },
        { status: 401 },
      )
    }
    const checkoutUser = user
    try {
      const input = JSON.parse(new TextDecoder().decode(body as ArrayBuffer))
      if (
        input?.expected_team !== undefined &&
        input.expected_team !==
          `${checkoutTeam?.region}:${checkoutTeam?.teamId}`
      ) {
        return NextResponse.json(
          {
            error: {
              code: "plan_team_changed",
              message: "Your active team changed. Reload to continue.",
            },
          },
          { status: 409 },
        )
      }
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "Invalid Checkout request",
          },
        },
        { status: 400 },
      )
    }
    const recoveryHeaders = new Headers(headers)
    recoveryHeaders.delete("content-length")
    recoveryHeaders.set("content-type", "application/json")
    const recoveryUrl = new URL(
      `${apiBaseUrl}/stripe/checkout-session/recover`,
    ).toString()
    const attemptRecovery = () =>
      fetch(recoveryUrl, {
        method: "POST",
        headers: recoveryHeaders,
        body: "{}",
      })
    const ensureCheckoutKey = async () => {
      if (!checkoutTeam) throw new Error("Billing team unavailable")
      const ensuredKey = await repairRecoveryAuthApiKeyForTeam(
        checkoutUser,
        checkoutTeam,
      )
      if (ensuredKey !== headers.get("X-API-Key")) {
        throw new Error("Billing team changed during Checkout preflight")
      }
    }
    let recovery: Response
    try {
      recovery = await attemptRecovery()
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "service_unavailable",
            message: "Checkout recovery unavailable",
          },
        },
        { status: 503 },
      )
    }
    try {
      // A missing key row can produce 401 before the backend can inspect a
      // Checkout. Repair it, then retry recovery before considering creation.
      if (recovery.status === 401) {
        try {
          await ensureCheckoutKey()
          recovery = await attemptRecovery()
        } catch {
          return NextResponse.json(
            {
              error: {
                code: "service_unavailable",
                message: "Checkout recovery authentication unavailable",
              },
            },
            { status: 503 },
          )
        }
      }
      const recoveryUnavailable =
        recovery.status === 409 &&
        (
          await recovery
            .clone()
            .json()
            .catch(() => null)
        )?.error?.code === "checkout_recovery_unavailable"
      if (!recoveryUnavailable) {
        return forwardResponse(
          recovery,
          joinedPath,
          impersonating,
          debugImpersonation,
          authMode,
          impersonationContext?.teamId ?? null,
        )
      }
      if (!teamRegion || !checkoutTeam)
        throw new Error("Billing team region unavailable")
      let input: Record<string, unknown>
      try {
        input = JSON.parse(new TextDecoder().decode(body as ArrayBuffer))
      } catch {
        return NextResponse.json(
          {
            error: {
              code: "invalid_request",
              message: "Invalid Checkout request",
            },
          },
          { status: 400 },
        )
      }
      if (input.prepare === true) {
        if (
          !validOperationId(input.operation_id) ||
          typeof input.success_url !== "string" ||
          typeof input.cancel_url !== "string"
        )
          return NextResponse.json(
            {
              error: {
                code: "invalid_request",
                message: "Checkout operation and redirects are required",
              },
            },
            { status: 400 },
          )
        if (
          [input.success_url, input.cancel_url].some((value) => {
            try {
              return new URL(value as string).origin !== request.nextUrl.origin
            } catch {
              return true
            }
          })
        )
          return NextResponse.json(
            {
              error: {
                code: "invalid_request",
                message: "Invalid Checkout redirects",
              },
            },
            { status: 400 },
          )
        const publication = await publishAccountPromotion(
          teamRegion,
          user,
          authObservedAt,
        )
        const receipt = signCheckoutIntent({
          actor: user.id,
          team: checkoutTeam.teamId,
          operation_id: input.operation_id,
          home_region: teamRegion,
          decision: publication.authorityUnavailable
            ? "publication_failed"
            : "standard",
          success_url: input.success_url,
          cancel_url: input.cancel_url,
        })
        return NextResponse.json(
          { receipt },
          { headers: { "cache-control": "private, no-store" } },
        )
      }
      if (!input.receipt)
        return NextResponse.json(
          {
            error: {
              code: "checkout_intent_required",
              message:
                "The original Checkout intent is required; please retry from billing",
            },
          },
          { status: 409 },
        )
      let intent
      try {
        intent = readCheckoutIntent(
          input.receipt,
          user.id,
          checkoutTeam.teamId,
          teamRegion,
        )
      } catch {
        return NextResponse.json(
          {
            error: {
              code: "invalid_checkout_intent",
              message: "Checkout intent does not match this account and team",
            },
          },
          { status: 400 },
        )
      }
      await ensureCheckoutKey()
      const { actor: _actor, team: _team, ...fields } = intent
      body = JSON.stringify(fields)
      headers.set("X-Promotion-Account-Assertion", checkoutAssertion(intent))
      upstreamUrl.pathname = "/stripe/checkout-session/publication-decision"
    } catch {
      console.error("Promotion identity publication failed", {
        operation: "upsert_profile_with_promotion_identity",
        cell:
          teamRegion === "use" || teamRegion === "usw" ? teamRegion : "unknown",
        error: "checkout_publication_unavailable",
      })
      return NextResponse.json(
        {
          error: {
            code: "service_unavailable",
            message: "Promotion identity unavailable; please retry",
          },
        },
        { status: 503 },
      )
    }
  }

  if (typeof body === "string") {
    headers.delete("content-length")
    headers.set("content-type", "application/json")
  }

  const response = await fetch(upstreamUrl.toString(), {
    method: request.method,
    headers,
    body,
  })

  return forwardResponse(
    response,
    joinedPath,
    impersonating,
    debugImpersonation,
    authMode,
    impersonationContext?.teamId ?? null,
  )
}

async function forwardResponse(
  response: Response,
  joinedPath: string,
  impersonating: boolean,
  debugImpersonation: boolean,
  authMode: string,
  impersonatedTeamId: string | null,
): Promise<NextResponse> {
  const responseHeaders = new Headers()
  for (const [key, value] of response.headers.entries()) {
    if (key === "transfer-encoding" || key === "content-encoding") {
      continue
    }
    responseHeaders.set(key, value)
  }
  if (
    joinedPath === "billing/summary" ||
    isPlanBillingPath(joinedPath) ||
    isPrepaidBillingPath(joinedPath) ||
    isBillingV2ReadPath(joinedPath)
  ) {
    responseHeaders.set("cache-control", "private, no-store")
  }
  setImpersonationDebugHeaders(
    responseHeaders,
    debugImpersonation,
    authMode,
    impersonatedTeamId,
  )

  // Per the Fetch spec, 204/205/304 responses must not have a body.
  // Next.js 16's NextResponse throws if you pass any body (even empty) for
  // these statuses, so we forward null and skip reading the upstream body.
  const isNullBodyStatus =
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304

  if (isNullBodyStatus) {
    return new NextResponse(null, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  }

  // Stream Server-Sent Events through unbuffered. Buffering via
  // arrayBuffer() would make the browser wait for the build to finish
  // before seeing any log output.
  const upstreamContentType = response.headers.get("content-type") ?? ""
  if (upstreamContentType.includes("text/event-stream")) {
    if (impersonating) {
      return NextResponse.json(
        {
          error: {
            code: "streaming_disabled_during_impersonation",
            message:
              "Streaming responses are disabled while viewing another team.",
          },
        },
        { status: 403 },
      )
    }

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

  if (impersonating) {
    const contentType = responseHeaders.get("content-type") ?? ""
    if (contentType.includes("application/json")) {
      const redacted = redactAccessTokens(new TextDecoder().decode(data))
      const body = new TextEncoder().encode(redacted)
      responseHeaders.set("content-length", String(body.byteLength))
      return new NextResponse(body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      })
    }
  }

  return new NextResponse(data, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export const GET = proxyRequest
export const POST = proxyRequest
export const PUT = proxyRequest
export const PATCH = proxyRequest
export const DELETE = proxyRequest
