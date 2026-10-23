import "server-only"
import { z } from "zod"

import { getImpersonationTeamId } from "@/lib/admin/impersonation"
import {
  canReadAdminBilling,
  canWriteAdminBilling,
} from "@/lib/admin/permissions"
import {
  cellFor,
  configuredRegions,
  internalApiTokenFor,
  operatorApiTokenFor,
} from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

export type AdminBillingErrorKind =
  | "forbidden"
  | "read_only_impersonation"
  | "not_found"
  | "conflict"
  | "invalid"
  | "unavailable"

export class AdminBillingRequestError extends Error {
  constructor(
    public readonly kind: AdminBillingErrorKind,
    public readonly detail?: string,
  ) {
    super(kind)
    this.name = "AdminBillingRequestError"
  }
}

const MAX_DETAIL_LENGTH = 300

const backendErrorSchema = z.object({
  error: z.object({ message: z.string() }),
})

// Backend 400/409/422 messages reach staff verbatim, so only routes whose
// handlers return fixed operator-facing messages may be called through here.
async function errorDetail(response: Response): Promise<string | undefined> {
  const parsed = backendErrorSchema.safeParse(
    await response.json().catch(() => null),
  )
  if (!parsed.success) return undefined
  const detail = parsed.data.error.message
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g,
      " ",
    )
    .trim()
  if (!detail) return undefined
  const chars = [...detail]
  return chars.length > MAX_DETAIL_LENGTH
    ? `${chars.slice(0, MAX_DETAIL_LENGTH - 1).join("")}…`
    : detail
}

type Access = "read" | "write"

export async function requireAdminBilling(access: Access = "read") {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const allowed =
    access === "write" ? canWriteAdminBilling(user) : canReadAdminBilling(user)
  if (!user || !allowed) throw new AdminBillingRequestError("forbidden")
  if (access === "write" && (await getImpersonationTeamId(user)))
    throw new AdminBillingRequestError("read_only_impersonation")
  return user
}

function errorKind(status: number): AdminBillingErrorKind {
  if (status === 403) return "forbidden"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status === 400 || status === 422) return "invalid"
  return "unavailable"
}

const BILLING_PATH =
  /^\/internal\/(billing|teams\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/billing)(\/[A-Za-z0-9_-]+)*$/

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const TEAM_BILLING = `/internal/teams/${UUID}/billing`

type WriteMethod = "POST" | "PUT" | "DELETE"

// Each write route must be an operator-group handler that re-checks
// platform:billing:write and never puts raw internal errors in 400/409/422.
const WRITE_ROUTES: [WriteMethod, string][] = [
  ["POST", `${TEAM_BILLING}/matching`],
  ["POST", `${TEAM_BILLING}/matching/revoke`],
  ["POST", `${TEAM_BILLING}/matching/credits/${UUID}/acknowledge`],
]

const WRITE_ROUTE_PATTERNS = WRITE_ROUTES.map(
  ([method, route]) => [method, new RegExp(`^${route}$`)] as const,
)

export function isAdminBillingPath(path: string, method = "GET"): boolean {
  if (!BILLING_PATH.test(path)) return false
  return (
    method === "GET" ||
    WRITE_ROUTE_PATTERNS.some(
      ([routeMethod, route]) => routeMethod === method && route.test(path),
    )
  )
}

export interface AdminBillingRequest<T> {
  region: string
  path: `/internal/${string}`
  query?: URLSearchParams
  schema: z.ZodType<T>
  method?: "GET" | WriteMethod
  body?: unknown
}

export async function adminBillingRequest<T>({
  region,
  path,
  query,
  schema,
  method = "GET",
  body,
}: AdminBillingRequest<T>): Promise<T> {
  const user = await requireAdminBilling(method === "GET" ? "read" : "write")
  if (!isAdminBillingPath(path, method))
    throw new AdminBillingRequestError("invalid")
  const internalToken = internalApiTokenFor(region)
  const token = method === "GET" ? internalToken : operatorApiTokenFor(region)
  if (
    !token ||
    (method !== "GET" && token === internalToken) ||
    !configuredRegions().includes(region)
  )
    throw new AdminBillingRequestError("unavailable")
  const url = new URL(path, cellFor(region).apiBaseUrl)
  if (query) url.search = query.toString()
  let response: Response
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Actor-User-Id": user.id,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new AdminBillingRequestError("unavailable")
  }
  if (!response.ok) {
    const kind = errorKind(response.status)
    throw new AdminBillingRequestError(
      kind,
      kind === "conflict" || kind === "invalid"
        ? await errorDetail(response)
        : undefined,
    )
  }
  const parsed = schema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new AdminBillingRequestError("unavailable")
  return parsed.data
}
