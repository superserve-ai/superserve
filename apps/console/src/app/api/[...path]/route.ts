import type { User } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { publishPromotionIdentity } from "@/lib/api/promotion-identity"
import {
  ensureAuthApiKeyForTeam,
  getAuthApiKeyAndTeamForRecovery,
  getAuthApiKeyAndTeamForUser,
  getAuthApiKeyForUser,
} from "@/lib/api/proxy-auth"
import { redactAccessTokens } from "@/lib/api/redact"
import type { TeamMembership } from "@/lib/api/team-directory"
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
  "providers",
  "billing/summary",
  "billing/usage-series",
]

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
    path === "stripe/customer-portal-session"
  )
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
  if (isTeamBillingPath(path)) return true
  if (isStripeBillingPath(path)) return true
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
  const checkoutRequest =
    joinedPath === "stripe/checkout-session" && request.method === "POST"
  const debugImpersonation =
    request.nextUrl.searchParams.get("__debug_impersonation") === "1"
  let user: User | null = null
  let authObservedAt: string | null = null
  let impersonationContext: { teamId: string; region: string } | null = null
  let impersonating = false

  if (!skipKeyInjection) {
    const supabase = await createServerClient()
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()
    user = authUser
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
    const selfContext = impersonationContext
      ? null
      : checkoutRequest
        ? await getAuthApiKeyAndTeamForRecovery(
            user,
            authObservedAt ?? undefined,
          )
        : await getAuthApiKeyAndTeamForUser(user, authObservedAt ?? undefined)
    if (checkoutRequest) checkoutTeam = selfContext?.team ?? null
    const apiKey = impersonationContext
      ? await getAuthApiKeyForUser(
          user,
          impersonationContext,
          authObservedAt ?? undefined,
        )
      : selfContext?.apiKey
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

  const body =
    request.method !== "GET" && request.method !== "HEAD"
      ? await request.arrayBuffer()
      : undefined

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
    const checkoutObservedAt = authObservedAt
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
      const ensuredKey = await ensureAuthApiKeyForTeam(
        checkoutUser,
        checkoutTeam,
        checkoutObservedAt,
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
        await ensureCheckoutKey()
        recovery = await attemptRecovery()
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
      if (!teamRegion) throw new Error("Billing team region unavailable")
      await publishPromotionIdentity(
        teamRegion,
        checkoutUser.id,
        checkoutUser,
        checkoutObservedAt,
      )
      await ensureCheckoutKey()
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
  if (joinedPath === "billing/summary") {
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
