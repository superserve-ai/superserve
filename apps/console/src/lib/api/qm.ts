import { apiClient } from "./client"
import type {
  CreateQmTenantRequest,
  QmAdminLink,
  QmSlugAvailability,
  QmTenant,
  QmTenantDetailResponse,
  QmTenantListResponse,
  QmTenantResponse,
} from "./types"

// All calls go through the console proxy, which maps /api/qm/* to the
// qm-api service (see app/api/[...path]/route.ts).

export async function listQmTenants(): Promise<QmTenant[]> {
  const res = await apiClient<QmTenantListResponse>("/qm/tenants")
  return res.tenants
}

export async function getQmTenant(id: string): Promise<QmTenantDetailResponse> {
  return apiClient<QmTenantDetailResponse>(
    `/qm/tenants/${encodeURIComponent(id)}`,
  )
}

/**
 * Provisions a tenant. The request body is the only place `modelKey` ever
 * travels — do not log the argument or retain it after the call.
 */
export async function createQmTenant(
  data: CreateQmTenantRequest,
): Promise<QmTenant> {
  const res = await apiClient<QmTenantResponse>("/qm/tenants", {
    method: "POST",
    body: JSON.stringify(data),
  })
  return res.tenant
}

export async function deleteQmTenant(id: string): Promise<QmTenant> {
  const res = await apiClient<QmTenantResponse>(
    `/qm/tenants/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  )
  return res.tenant
}

export async function retryQmTenant(id: string): Promise<QmTenant> {
  const res = await apiClient<QmTenantResponse>(
    `/qm/tenants/${encodeURIComponent(id)}/retry`,
    { method: "POST" },
  )
  return res.tenant
}

/**
 * Mints a single-use, short-lived admin sign-in link. A POST so the proxy's
 * read-only impersonation guard refuses it; never store the result in the
 * query cache.
 */
export async function getQmAdminLink(id: string): Promise<QmAdminLink> {
  return apiClient<QmAdminLink>(
    `/qm/tenants/${encodeURIComponent(id)}/admin-link`,
    { method: "POST" },
  )
}

export async function checkQmSlug(slug: string): Promise<QmSlugAvailability> {
  return apiClient<QmSlugAvailability>(
    `/qm/slugs/${encodeURIComponent(slug)}/availability`,
  )
}
