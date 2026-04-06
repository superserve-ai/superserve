import {
  createApiKeyAction,
  listApiKeysAction,
  revokeApiKeyAction,
} from "./api-keys-actions"
import type { ApiKeyResponse, CreateApiKeyResponse } from "./types"

export async function listApiKeys(): Promise<ApiKeyResponse[]> {
  return listApiKeysAction()
}

export async function createApiKey(data: {
  name: string
}): Promise<CreateApiKeyResponse> {
  return createApiKeyAction(data.name)
}

export async function revokeApiKey(id: string): Promise<void> {
  return revokeApiKeyAction(id)
}
