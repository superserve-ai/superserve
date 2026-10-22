import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  SandboxError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "@superserve/sdk"

import { connection, USER_AGENT } from "./config"
import { CliError, EXIT } from "./errors"

// Control-plane calls go straight to the API (no activate side effects); errors
// map to the SDK's typed errors so handling stays uniform.

const DEFAULT_TIMEOUT_MS = 30_000

export interface ApiRequest {
  query?: Record<string, string | undefined>
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
}

const RETRYABLE = new Set([429, 502, 503, 504])
const MAX_ATTEMPTS = 3

/** GET and DELETE retry 429/502/503/504 and network errors, like the SDK; POST/PATCH never do. */
export async function apiFetch(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  req: ApiRequest = {},
): Promise<Response> {
  const idempotent = method === "GET" || method === "DELETE"
  for (let attempt = 1; ; attempt++) {
    const last = !idempotent || attempt >= MAX_ATTEMPTS
    let res: Response
    try {
      res = await send(method, path, req)
    } catch (err) {
      if (last || err instanceof TimeoutError || req.signal?.aborted) throw err
      await backoff(attempt, null, req.signal)
      continue
    }
    if (res.ok) return res
    if (last || !RETRYABLE.has(res.status)) throw await toApiError(res)
    await backoff(attempt, res.headers.get("Retry-After"), req.signal)
  }
}

async function send(
  method: string,
  path: string,
  req: ApiRequest,
): Promise<Response> {
  const conn = connection()
  const url = new URL(`${conn.baseUrl.replace(/\/+$/, "")}${path}`)
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v)
  }
  const timeout = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout
  try {
    return await fetch(url, {
      method,
      headers: {
        "X-API-Key": conn.apiKey,
        "User-Agent": USER_AGENT,
        ...req.headers,
        ...(req.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal,
    })
  } catch (err) {
    if (timeout.aborted && !req.signal?.aborted) {
      throw new TimeoutError(`${method} ${path} timed out`)
    }
    throw err
  }
}

/** Retry-After is delta-seconds or an HTTP-date; capped at 30s. */
export function retryAfterMs(value?: string | null): number | undefined {
  if (!value) return undefined
  const secs = Number(value)
  const ms = Number.isFinite(secs)
    ? secs * 1000
    : Date.parse(value) - Date.now()
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 30_000) : undefined
}

function backoff(
  attempt: number,
  retryAfter: string | null,
  signal?: AbortSignal,
): Promise<void> {
  const ms =
    retryAfterMs(retryAfter) ??
    Math.min(200 * 2 ** (attempt - 1), 2_000) * (0.8 + Math.random() * 0.4)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const done = () => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** Parsed body plus status and headers, for callers that need either. */
export async function apiJson<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  req?: ApiRequest,
): Promise<{ data: T; status: number; headers: Headers }> {
  const idempotent = method === "GET" || method === "DELETE"
  for (let attempt = 1; ; attempt++) {
    const res = await apiFetch(method, path, req)
    const meta = { status: res.status, headers: res.headers }
    if (res.status === 204) return { data: undefined as T, ...meta }
    try {
      return { data: (await res.json()) as T, ...meta }
    } catch (err) {
      // A body that stalls or arrives truncated: retry what's safe to repeat.
      if (req?.signal?.aborted) throw err
      if (idempotent && attempt < MAX_ATTEMPTS) continue
      throw err instanceof Error && err.name === "TimeoutError"
        ? new TimeoutError(`${method} ${path} timed out`)
        : err
    }
  }
}

export async function apiRequest<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  req?: ApiRequest,
): Promise<T> {
  return (await apiJson<T>(method, path, req)).data
}

async function toApiError(res: Response): Promise<SandboxError> {
  let body: { error?: { code?: string; message?: string } } = {}
  try {
    body = await res.json()
  } catch {}
  const message = body.error?.message ?? `API error (${res.status})`
  const code = body.error?.code
  switch (res.status) {
    case 400:
      return new ValidationError(message, code)
    case 401:
    case 403:
      return new AuthenticationError(message, code, res.status)
    case 404:
      return new NotFoundError(message, code)
    case 409:
      return new ConflictError(message, code)
    case 429:
      return new RateLimitError(message, code)
    default:
      return res.status >= 500
        ? new ServerError(message, code, res.status)
        : new SandboxError(message, res.status, code)
  }
}

export interface ActivatedSandbox {
  id: string
  name: string
  status: string
  access_token: string
  routing_hint?: string
}

/** Resume if paused and mint a fresh access token, waiting out a pause still finishing. */
export async function activate(sandboxId: string): Promise<ActivatedSandbox> {
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      return await apiRequest<ActivatedSandbox>(
        "POST",
        `/sandboxes/${encodeURIComponent(sandboxId)}/activate`,
        { timeoutMs: 120_000 },
      )
    } catch (err) {
      if (
        !(err instanceof ConflictError) ||
        err.code !== "sandbox_pausing" ||
        Date.now() > deadline
      ) {
        throw err
      }
      await new Promise((r) => setTimeout(r, 1_000))
    }
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(s: string): boolean {
  return UUID_RE.test(s)
}

// Region cells mint public sandbox IDs as sb-<region>-<uuid>; others are bare.
const SANDBOX_ID_RE =
  /^(?:sb-[a-z0-9]{1,17}-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isSandboxId(s: string): boolean {
  return SANDBOX_ID_RE.test(s)
}

/** An ID is used as-is; a name costs one list call and must match exactly one sandbox. */
export async function resolveSandboxId(ref: string): Promise<string> {
  if (isSandboxId(ref)) return ref
  const matches = (
    await apiRequest<{ id: string; name: string; status: string }[]>(
      "GET",
      "/sandboxes",
      // No limit: an unpaged list is complete, and q already narrows it.
      { query: { q: ref } },
    )
  ).filter((s) => s.name === ref)
  if (matches.length === 1) return matches[0].id
  if (matches.length === 0) {
    throw new CliError(
      `No sandbox named "${ref}".`,
      EXIT.NOT_FOUND,
      "Run `superserve sandbox list` to see your sandboxes.",
      "not_found",
    )
  }
  throw new CliError(
    `${matches.length} sandboxes are named "${ref}"; use an ID instead:\n${matches
      .map((m) => `  ${m.id}  ${m.status}`)
      .join("\n")}`,
    EXIT.USAGE,
    undefined,
    "ambiguous",
  )
}
