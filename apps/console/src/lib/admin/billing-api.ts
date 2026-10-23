import "server-only"
import type { z } from "zod"

import {
  canReadAdminBilling,
  canWriteAdminBilling,
} from "@/lib/admin/permissions"
import { cellFor, configuredRegions, internalApiTokenFor } from "@/lib/cells"
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
  return user
}

function errorKind(status: number): AdminBillingErrorKind {
  if (status === 401 || status === 403) return "forbidden"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status === 400 || status === 422) return "invalid"
  return "unavailable"
}

export interface AdminBillingRequest<T> {
  region: string
  path: `/internal/${string}`
  schema: z.ZodType<T>
  method?: "GET" | "POST" | "PUT" | "DELETE"
  body?: unknown
}

export async function adminBillingRequest<T>({
  region,
  path,
  schema,
  method = "GET",
  body,
}: AdminBillingRequest<T>): Promise<T> {
  const user = await requireAdminBilling(method === "GET" ? "read" : "write")
  const token = internalApiTokenFor(region)
  if (!token || !configuredRegions().includes(region))
    throw new AdminBillingRequestError("unavailable")
  let response: Response
  try {
    response = await fetch(new URL(path, cellFor(region).apiBaseUrl), {
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
