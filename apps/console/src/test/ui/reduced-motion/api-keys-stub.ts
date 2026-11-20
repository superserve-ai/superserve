"use client"

import type { ApiKeyResponse, CreateApiKeyResponse } from "@/lib/api/types"

// Replaces API-key server actions so the production hooks never reach Supabase.
export async function listApiKeysAction(): Promise<ApiKeyResponse[]> {
  return []
}

export async function createApiKeyAction(
  name: string,
): Promise<CreateApiKeyResponse> {
  return {
    id: "key-fixture",
    name,
    key: "ss_live_fixture_xxxxxxxx",
    prefix: "ss_live_fixture",
    created_at: "2026-11-01T09:30:00Z",
  }
}

export async function revokeApiKeyAction(_id: string): Promise<void> {}
