import { apiClient } from "./client"
import type { CreateSandboxRequest, SandboxResponse } from "./types"

export async function listSandboxes(): Promise<SandboxResponse[]> {
  return apiClient<SandboxResponse[]>("/v1/sandboxes")
}

export async function getSandbox(id: string): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>(`/v1/sandboxes/${id}`)
}

export async function createSandbox(
  data: CreateSandboxRequest,
): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>("/v1/sandboxes", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function deleteSandbox(id: string): Promise<void> {
  return apiClient<void>(`/v1/sandboxes/${id}`, {
    method: "DELETE",
  })
}

export async function pauseSandbox(id: string): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>(`/v1/sandboxes/${id}/pause`, {
    method: "POST",
  })
}

export async function resumeSandbox(id: string): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>(`/v1/sandboxes/${id}/resume`, {
    method: "POST",
  })
}
