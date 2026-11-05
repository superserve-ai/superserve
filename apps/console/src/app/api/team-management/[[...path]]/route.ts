import { type NextRequest, NextResponse } from "next/server"

import { canViewOtherUsersAccount } from "@/lib/admin/permissions"
import {
  getApiBaseUrlForUser,
  getAuthApiKeyForUser,
  getRegionForUser,
  getTeamIdForUser,
} from "@/lib/api/proxy-auth"
import { GoogleSignupRecoveryRequiredError } from "@/lib/auth/google-signup-proof"
import {
  SIGNUP_RESTRICTED_MESSAGE,
  SignupRestrictedError,
} from "@/lib/auth/signup-restrictions"
import { createServerClient } from "@/lib/supabase/server"

const FORWARD_REQUEST_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "content-length",
  "content-type",
  "idempotency-key",
  "user-agent",
])

// Path IDs are forwarded and compared verbatim, so only the canonical form is
// accepted. Hyphenless, braced, URN and uppercase spellings all parse as the
// same UUID upstream and would slip past the self-removal check below.
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Mutations carry the team the page was showing as "<region>:<teamId>"; the
// active team is a cookie another tab can move.
const TEAM_SCOPE_HEADER = "x-superserve-team-scope"

type RouteContext = { params: Promise<{ path?: string[] }> }

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}

function invalidId(): NextResponse {
  return NextResponse.json(
    { error: { code: "invalid_id", message: "Invalid identifier" } },
    { status: 400 },
  )
}

function teamChanged(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "team_changed",
        message: "Your active team changed. Reload the page and try again.",
      },
    },
    { status: 409 },
  )
}

function signupDenied(): NextResponse {
  return NextResponse.json(
    { error: { code: "signup_blocked", message: SIGNUP_RESTRICTED_MESSAGE } },
    { status: 403 },
  )
}

function googleRecovery(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "google_signup_recovery_required",
        message: "Complete signup with Google to continue.",
      },
    },
    { status: 403 },
  )
}

function upstreamPath(
  method: string,
  teamId: string,
  path: string[],
  { staff, userId }: { staff: boolean; userId: string },
): string | null {
  if (method === "GET" && path.length === 0) {
    return `/teams/${encodeURIComponent(teamId)}/management`
  }

  // Read-only on purpose. Invitation create/resend responses carry the
  // plaintext token, which only the recipient's email may contain, so those
  // run in server actions and are not reachable through this proxy.
  if (method === "GET" && path.length === 1 && path[0] === "invitations") {
    return `/teams/${encodeURIComponent(teamId)}/invitations`
  }

  // Customers can remove other members. Removing yourself goes through the
  // leave-team action, which enforces the only-team rule.
  if (method === "DELETE" && path.length === 2 && path[0] === "members") {
    if (!staff && path[1] === userId.toLowerCase()) return null
    return `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(path[1])}`
  }

  // Direct member adds and role assignment remain platform-staff tools.
  if (!staff) return null

  if (method === "POST" && path.length === 1 && path[0] === "members") {
    return `/teams/${encodeURIComponent(teamId)}/members`
  }

  if (method === "POST" && path.length === 1 && path[0] === "roles") {
    return `/teams/${encodeURIComponent(teamId)}/roles`
  }

  if (method === "DELETE" && path.length === 2 && path[0] === "roles") {
    return `/teams/${encodeURIComponent(teamId)}/roles/${encodeURIComponent(path[1])}`
  }

  return null
}

async function proxyTeamManagementRequest(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const observedAt = new Date().toISOString()
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Not authenticated" } },
      { status: 401 },
    )
  }

  let teamId: string
  try {
    teamId = await getTeamIdForUser(user, observedAt)
  } catch (error) {
    if (error instanceof GoogleSignupRecoveryRequiredError)
      return googleRecovery()
    if (error instanceof SignupRestrictedError) return signupDenied()
    throw error
  }
  const { path = [] } = await params
  if (
    request.method === "DELETE" &&
    path.length === 2 &&
    (path[0] === "members" || path[0] === "roles") &&
    !CANONICAL_UUID.test(path[1])
  ) {
    return invalidId()
  }
  const targetPath = upstreamPath(request.method, teamId, path, {
    staff: canViewOtherUsersAccount(user),
    userId: user.id,
  })
  if (!targetPath) {
    return notFound()
  }
  const isManagementRead = request.method === "GET" && path.length === 0
  let region: string | null = null
  if (
    isManagementRead ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    try {
      region = await getRegionForUser(user)
    } catch (error) {
      if (error instanceof GoogleSignupRecoveryRequiredError)
        return googleRecovery()
      if (error instanceof SignupRestrictedError) return signupDenied()
      throw error
    }
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (request.headers.get(TEAM_SCOPE_HEADER) !== `${region}:${teamId}`) {
      return teamChanged()
    }
  }

  let apiKey: string | null
  try {
    apiKey = await getAuthApiKeyForUser(user, undefined, observedAt)
  } catch (error) {
    if (error instanceof GoogleSignupRecoveryRequiredError)
      return googleRecovery()
    if (error instanceof SignupRestrictedError) return signupDenied()
    throw error
  }
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Not authenticated" } },
      { status: 401 },
    )
  }

  // Team management lives in the team's home cell's control plane.
  let apiBaseUrl: string
  try {
    apiBaseUrl = await getApiBaseUrlForUser(user)
  } catch (error) {
    if (error instanceof GoogleSignupRecoveryRequiredError)
      return googleRecovery()
    if (error instanceof SignupRestrictedError) return signupDenied()
    throw error
  }
  const url = new URL(`${apiBaseUrl}${targetPath}`)
  if (request.method === "GET" || request.method === "HEAD") {
    url.search = request.nextUrl.search
  }

  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    if (FORWARD_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }
  headers.set("X-API-Key", apiKey)

  const body =
    request.method !== "GET" && request.method !== "HEAD"
      ? await request.arrayBuffer()
      : undefined

  const response = await fetch(url.toString(), {
    method: request.method,
    headers,
    body,
  })

  const responseHeaders = new Headers()
  for (const [key, value] of response.headers.entries()) {
    if (key === "transfer-encoding" || key === "content-encoding") {
      continue
    }
    responseHeaders.set(key, value)
  }
  if (isManagementRead) {
    responseHeaders.set(TEAM_SCOPE_HEADER, `${region}:${teamId}`)
  }

  if (
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304
  ) {
    return new NextResponse(null, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  }

  return new NextResponse(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export const GET = proxyTeamManagementRequest
export const POST = proxyTeamManagementRequest
export const DELETE = proxyTeamManagementRequest
