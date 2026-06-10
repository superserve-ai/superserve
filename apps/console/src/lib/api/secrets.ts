import { apiClient } from "./client"
import type {
  AuditStatusFilter,
  CreateSecretRequest,
  NetworkEvent,
  ProviderShortcut,
  ProxyAuditEvent,
  SecretResponse,
  SecretSandboxBinding,
  UpdateSecretRequest,
} from "./types"

export async function listSecrets(): Promise<SecretResponse[]> {
  return apiClient<SecretResponse[]>("/secrets")
}

export async function getSecret(name: string): Promise<SecretResponse> {
  return apiClient<SecretResponse>(`/secrets/${name}`)
}

export async function createSecret(
  data: CreateSecretRequest,
): Promise<SecretResponse> {
  return apiClient<SecretResponse>("/secrets", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function updateSecretValue(
  name: string,
  data: UpdateSecretRequest,
): Promise<SecretResponse> {
  return apiClient<SecretResponse>(`/secrets/${name}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  })
}

export async function deleteSecret(name: string): Promise<void> {
  return apiClient<void>(`/secrets/${name}`, {
    method: "DELETE",
  })
}

export interface AuditQueryParams {
  limit?: number
  before?: number
  status?: AuditStatusFilter
}

function auditQueryString(params: AuditQueryParams | undefined): string {
  if (!params) return ""
  const usp = new URLSearchParams()
  if (params.limit != null) usp.set("limit", String(params.limit))
  if (params.before != null) usp.set("before", String(params.before))
  if (params.status) usp.set("status", params.status)
  const s = usp.toString()
  return s ? `?${s}` : ""
}

export async function getSecretAudit(
  name: string,
  params?: AuditQueryParams,
): Promise<ProxyAuditEvent[]> {
  return apiClient<ProxyAuditEvent[]>(
    `/secrets/${name}/audit${auditQueryString(params)}`,
  )
}

export async function getSecretSandboxes(
  name: string,
): Promise<SecretSandboxBinding[]> {
  return apiClient<SecretSandboxBinding[]>(`/secrets/${name}/sandboxes`)
}

export async function getSandboxNetwork(
  sandboxId: string,
  params?: { before?: string; limit?: number },
): Promise<NetworkEvent[]> {
  const usp = new URLSearchParams()
  if (params?.before) usp.set("before", params.before)
  if (params?.limit != null) usp.set("limit", String(params.limit))
  const qs = usp.toString()
  return apiClient<NetworkEvent[]>(
    `/sandboxes/${sandboxId}/network${qs ? `?${qs}` : ""}`,
  )
}

export async function listProviders(): Promise<ProviderShortcut[]> {
  return apiClient<ProviderShortcut[]>("/providers")
}
