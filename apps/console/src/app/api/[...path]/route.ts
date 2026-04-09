import { type NextRequest, NextResponse } from "next/server"
import { getAuthApiKey } from "@/lib/api/proxy-auth"

const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL ?? "https://api.superserve.ai"

const ALLOWED_PREFIXES = ["sandboxes", "health", "v1"]

/** Paths that carry their own auth (e.g. Bearer token). */
const SKIP_KEY_INJECTION = ["v1/auth/"]

function isAllowedPath(path: string): boolean {
  return ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )
}

function shouldSkipKeyInjection(path: string): boolean {
  return SKIP_KEY_INJECTION.some((prefix) => path.startsWith(prefix))
}

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params
  const joinedPath = path.join("/")

  if (!isAllowedPath(joinedPath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const url = new URL(`${SANDBOX_API_URL}/${joinedPath}`)
  url.search = request.nextUrl.search

  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    if (key === "host" || key === "connection" || key === "transfer-encoding") {
      continue
    }
    headers.set(key, value)
  }

  // Inject server-side API key for authenticated requests
  if (!shouldSkipKeyInjection(joinedPath)) {
    const apiKey = await getAuthApiKey()
    if (!apiKey) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Not authenticated" } },
        { status: 401 },
      )
    }
    headers.set("X-API-Key", apiKey)
  }

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

  // Per the Fetch spec, 204/205/304 responses must not have a body.
  // Next.js 16's NextResponse throws if you pass any body (even empty) for
  // these statuses, so we forward null and skip reading the upstream body.
  const isNullBodyStatus =
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304

  const data = isNullBodyStatus ? null : await response.arrayBuffer()

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
