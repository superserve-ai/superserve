import { type NextRequest, NextResponse } from "next/server"

import { canViewOtherUsersAccount } from "@/lib/admin/permissions"
import {
  getApiBaseUrlForUser,
  getAuthApiKeyForUser,
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

type RouteContext = { params: Promise<{ path?: string[] }> }

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
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
): string | null {
  if (method === "GET" && path.length === 0) {
    return `/teams/${encodeURIComponent(teamId)}/management`
  }

  if (method === "POST" && path.length === 1 && path[0] === "members") {
    return `/teams/${encodeURIComponent(teamId)}/members`
  }

  if (method === "DELETE" && path.length === 2 && path[0] === "members") {
    return `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(path[1])}`
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
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Not authenticated" } },
      { status: 401 },
    )
  }
  if (!canViewOtherUsersAccount(user)) {
    return notFound()
  }

  let teamId: string
  try {
    teamId = await getTeamIdForUser(user)
  } catch (error) {
    if (error instanceof GoogleSignupRecoveryRequiredError)
      return googleRecovery()
    if (error instanceof SignupRestrictedError) return signupDenied()
    throw error
  }
  const { path = [] } = await params
  const targetPath = upstreamPath(request.method, teamId, path)
  if (!targetPath) {
    return notFound()
  }

  let apiKey: string | null
  try {
    apiKey = await getAuthApiKeyForUser(user)
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
