import { apiClient } from "./client"
import type {
  CreateSandboxRequest,
  SandboxPatch,
  SandboxResponse,
} from "./types"

export async function listSandboxes(): Promise<SandboxResponse[]> {
  return apiClient<SandboxResponse[]>("/sandboxes")
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

export async function pauseSandbox(id: string): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>(`/sandboxes/${id}/pause`, {
    method: "POST",
  })
}

export async function resumeSandbox(id: string): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>(`/sandboxes/${id}/resume`, {
    method: "POST",
  })
}
