import {
  createApiKeyAction,
  listApiKeysAction,
  revokeApiKeyAction,
} from "./api-keys-actions"
import { ApiError } from "./client"
import type { ApiKeyResponse, CreateApiKeyResponse } from "./types"

export async function listApiKeys(): Promise<ApiKeyResponse[]> {
  const result = await listApiKeysAction()
  if ("code" in result) throw new ApiError(403, result.code, result.message)
  return result
}

export async function createApiKey(data: {
  name: string
}): Promise<CreateApiKeyResponse> {
  const result = await createApiKeyAction(data.name)
  if ("code" in result) throw new ApiError(403, result.code, result.message)
  return result
}

export async function revokeApiKey(id: string): Promise<void> {
  const result = await revokeApiKeyAction(id)
  if (result && "code" in result)
    throw new ApiError(403, result.code, result.message)
}
