import { apiClient } from "./client"
import type {
  CreateSandboxRequest,
  ResumeResponse,
  SandboxListItem,
  SandboxPatch,
  SandboxResponse,
} from "./types"

export async function listSandboxes(): Promise<SandboxListItem[]> {
  return apiClient<SandboxListItem[]>("/sandboxes")
}

export async function getSandbox(id: string): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>(`/sandboxes/${id}`)
}

export async function createSandbox(
  data: CreateSandboxRequest,
): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>("/sandboxes", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function deleteSandbox(id: string): Promise<void> {
  return apiClient<void>(`/sandboxes/${id}`, {
    method: "DELETE",
  })
}

export async function patchSandbox(
  id: string,
  data: SandboxPatch,
): Promise<void> {
  return apiClient<void>(`/sandboxes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  })
}

export async function pauseSandbox(id: string): Promise<void> {
  return apiClient<void>(`/sandboxes/${id}/pause`, {
    method: "POST",
  })
}

export async function resumeSandbox(id: string): Promise<ResumeResponse> {
  return apiClient<ResumeResponse>(`/sandboxes/${id}/resume`, {
    method: "POST",
  })
}

export async function attachSandboxSecret(
  id: string,
  envKey: string,
  secretName: string,
): Promise<void> {
  return apiClient<void>(`/sandboxes/${id}/secrets`, {
    method: "POST",
    body: JSON.stringify({ env_key: envKey, secret_name: secretName }),
  })
}

export async function detachSandboxSecret(
  id: string,
  envKey: string,
): Promise<void> {
  return apiClient<void>(
    `/sandboxes/${id}/secrets/${encodeURIComponent(envKey)}`,
    { method: "DELETE" },
  )
}
