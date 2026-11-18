// First-party route for Heedeo's script and identify endpoint, as Heedeo
// documents for "your own server" (docs.heedeo.com, section 2). It mirrors the
// `heedeo.proxy` of `@heedeo/sdk` 0.2.0-beta.1 with tighter limits:
// - one fixed upstream origin and two fixed paths; anything else is a 404
//   that never leaves the console, and both paths answer 403 when off;
// - only the request headers identify reads, and only Heedeo's own `_idd`
//   cookie, go up; console session cookies never do;
// - only the response headers the browser needs, and only an `_idd`
//   Set-Cookie (host-only), come back;
// - 64 KB request body, 1 MB response body, 3 s for the whole exchange, no
//   redirects followed.

import { heedeoObservationEnabled, heedeoSecretKey } from "./config"

export const HEEDEO_UPSTREAM = "https://app.heedeo.com"

const ROUTES: Record<string, readonly string[]> = {
  "/i.js": ["GET"],
  "/v1/identify": ["POST", "OPTIONS"],
}

const UP_HEADERS = [
  "origin",
  "user-agent",
  "content-type",
  "accept-language",
  "sec-ch-ua",
  "sec-ch-ua-platform",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform-version",
  "sec-ch-ua-model",
  "sec-ch-ua-arch",
  "sec-ch-ua-bitness",
  "sec-ch-ua-full-version-list",
  "if-none-match",
] as const

const BACK_HEADERS = new Set([
  "content-type",
  "cache-control",
  "etag",
  "accept-ch",
])
const BACK_PREFIX = "access-control-"
const VISITOR_COOKIE = "_idd"

export const HEEDEO_PROXY_BODY_MAX = 64 * 1024
export const HEEDEO_PROXY_RESPONSE_MAX = 1024 * 1024
export const HEEDEO_PROXY_TIMEOUT_MS = 3000
const SEARCH_MAX = 2048

export type HeedeoProxyOptions = {
  enabled: boolean
  secretKey: string | undefined
  clientIp: string | null
  ja4?: string | null
  fetch?: typeof fetch
  timeoutMs?: number
}

const refuse = (
  status: number,
  code: string,
  headers: Record<string, string> = {},
) =>
  Response.json(
    { error: { code } },
    { status, headers: { "cache-control": "no-store", ...headers } },
  )

/**
 * The visitor's IP as Vercel reports it. Vercel overwrites `x-real-ip` and
 * `x-forwarded-for` with the connecting client's address; never read
 * `cf-connecting-ip`, which a caller can set. Off Vercel nothing vouches for
 * these headers, so there is no trusted IP.
 */
export function trustedClientIp(headers: Headers): string | null {
  if (!process.env.VERCEL) return null
  const value =
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return value && /^[0-9a-fA-F:.]{2,45}$/.test(value) ? value : null
}

/** The proxy settings for a request on this deployment. */
export function heedeoProxyOptions(headers: Headers): HeedeoProxyOptions {
  const ja4 = process.env.VERCEL ? headers.get("x-vercel-ja4-digest") : null
  return {
    enabled: heedeoObservationEnabled(),
    secretKey: heedeoSecretKey(),
    clientIp: trustedClientIp(headers),
    ja4: ja4 && /^[A-Za-z0-9_]{1,64}$/.test(ja4) ? ja4 : null,
  }
}

function visitorCookie(header: string | null): string | null {
  for (const pair of header?.split(";") ?? []) {
    const [name, ...value] = pair.trim().split("=")
    if (name === VISITOR_COOKIE) {
      const joined = value.join("=")
      return /^[A-Za-z0-9._~+/=-]{1,1024}$/.test(joined)
        ? `${VISITOR_COOKIE}=${joined}`
        : null
    }
  }
  return null
}

// Only Heedeo's visitor cookie, and only for this host: drop any Domain
// attribute so the cookie cannot widen to other superserve.ai subdomains.
function visitorSetCookie(value: string): string | null {
  const [pair, ...attributes] = value.split(";")
  const name = pair?.split("=")[0]?.trim()
  if (name !== VISITOR_COOKIE) return null
  return [
    pair.trim(),
    ...attributes
      .map((attribute) => attribute.trim())
      .filter(
        // Browsers trim spaces around the name, so `Domain = x` counts too.
        (attribute) =>
          attribute &&
          attribute.split("=", 1)[0]!.trim().toLowerCase() !== "domain",
      ),
  ].join("; ")
}

export async function readCapped(
  stream: ReadableStream<Uint8Array> | null,
  max: number,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array()
  const reader = stream.getReader()
  const stop = () => void reader.cancel().catch(() => {})
  signal.addEventListener("abort", stop, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      size += value.byteLength
      if (size > max) return null
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener("abort", stop)
    await reader.cancel().catch(() => {})
  }
  const body = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    body.set(chunk, at)
    at += chunk.byteLength
  }
  return body
}

/**
 * Forwards one browser request to Heedeo. `segments` is the route's
 * catch-all parameter (the part after `HEEDEO_PROXY_PREFIX`). Never throws;
 * every failure is a JSON error the script treats as "no token".
 */
export async function forwardHeedeoRequest(
  request: Request,
  segments: readonly string[],
  options: HeedeoProxyOptions,
): Promise<Response> {
  const path = `/${segments.join("/")}`
  const methods = Object.hasOwn(ROUTES, path) ? ROUTES[path] : undefined
  if (!methods) return refuse(404, "not_found")
  // 403, not 404: the script retries identify directly against Heedeo's own
  // host after a 404 or 5xx, which would bypass the kill switch.
  if (!options.enabled || !options.secretKey) return refuse(403, "disabled")
  if (!methods.includes(request.method))
    return refuse(405, "method_not_allowed", { allow: methods.join(", ") })
  if (!options.clientIp) return refuse(503, "not_configured")
  const url = new URL(request.url)
  if (url.search.length > SEARCH_MAX) return refuse(414, "uri_too_long")

  try {
    // Inside the try: a key or header value that `Headers` rejects is a
    // failure like any other.
    const headers = new Headers({
      authorization: `Bearer ${options.secretKey}`,
      "x-heedeo-client-ip": options.clientIp,
    })
    for (const name of UP_HEADERS) {
      const value = request.headers.get(name)
      if (value !== null) headers.set(name, value)
    }
    const cookie = visitorCookie(request.headers.get("cookie"))
    if (cookie) headers.set("cookie", cookie)
    if (request.method === "POST" && options.ja4)
      headers.set("x-heedeo-connection", JSON.stringify({ ja4: options.ja4 }))

    const signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? HEEDEO_PROXY_TIMEOUT_MS),
      request.signal,
    ])
    let body: Uint8Array | undefined
    if (request.method === "POST") {
      if (
        Number(request.headers.get("content-length") ?? 0) >
        HEEDEO_PROXY_BODY_MAX
      )
        return refuse(413, "too_large")
      const read = await readCapped(request.body, HEEDEO_PROXY_BODY_MAX, signal)
      if (!read) return refuse(413, "too_large")
      body = read
    }
    // The target is built from constants only: the browser picks one of two
    // fixed paths and supplies the query string, never the host.
    const target = new URL(path, HEEDEO_UPSTREAM)
    target.search = url.search
    const upstream = await (options.fetch ?? fetch)(target, {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      redirect: "manual",
      cache: "no-store",
      signal,
    })
    const notModified = upstream.status === 304
    if (upstream.status >= 300 && upstream.status < 400 && !notModified) {
      await upstream.body?.cancel().catch(() => {})
      return refuse(502, "upstream_unreachable")
    }
    const back = new Headers()
    for (const [name, value] of upstream.headers)
      if (BACK_HEADERS.has(name) || name.startsWith(BACK_PREFIX))
        back.set(name, value)
    // The browser revalidates the script on every load, so a cached copy
    // stops running as soon as the kill switch answers 403. The script also
    // fetches `i.js?m=1`, a marker it reads back from the browser cache:
    // that one keeps Heedeo's cache policy.
    if (path === "/i.js" && !url.searchParams.has("m"))
      back.set("cache-control", "no-cache")
    // A browser that opens a proxied answer directly gets an inert document:
    // an upstream error or challenge page cannot run on the console origin.
    // Script and fetch answers ignore this header.
    back.set("content-security-policy", "sandbox; default-src 'none'")
    back.set("x-content-type-options", "nosniff")
    for (const value of upstream.headers.getSetCookie()) {
      const kept = visitorSetCookie(value)
      if (kept) back.append("set-cookie", kept)
    }
    // These statuses must not carry a body, even an empty one.
    if ([204, 205, 304].includes(upstream.status)) {
      await upstream.body?.cancel().catch(() => {})
      return new Response(null, { status: upstream.status, headers: back })
    }
    const payload = await readCapped(
      upstream.body,
      HEEDEO_PROXY_RESPONSE_MAX,
      signal,
    )
    if (!payload) return refuse(502, "upstream_unreachable")
    return new Response(payload as BodyInit, {
      status: upstream.status,
      headers: back,
    })
  } catch {
    // Timeout, abort, network or header error: fail open, the page sends no
    // token.
    return refuse(502, "upstream_unreachable")
  }
}
