import "server-only"
import type { z } from "zod"

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
  | "not_found"
  | "conflict"
  | "invalid"
  | "unavailable"

export class AdminBillingRequestError extends Error {
  constructor(public readonly kind: AdminBillingErrorKind) {
    super(kind)
    this.name = "AdminBillingRequestError"
  }
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
    throw new AdminBillingRequestError("forbidden")
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
  if (!response.ok)
    throw new AdminBillingRequestError(errorKind(response.status))
  const parsed = schema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new AdminBillingRequestError("unavailable")
  return parsed.data
}
