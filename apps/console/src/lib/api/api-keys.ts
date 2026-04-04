import { apiClient } from "./client"
import type {
  ApiKeyResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
} from "./types"

export async function listApiKeys(): Promise<ApiKeyResponse[]> {
  return apiClient<ApiKeyResponse[]>("/v1/api-keys")
}

export async function createApiKey(
  data: CreateApiKeyRequest,
): Promise<CreateApiKeyResponse> {
  return apiClient<CreateApiKeyResponse>("/v1/api-keys", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function revokeApiKey(id: string): Promise<void> {
  return apiClient<void>(`/v1/api-keys/${id}`, {
    method: "DELETE",
  })
}
