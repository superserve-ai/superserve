"use client"

import { useToast } from "@superserve/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api/api-keys"
import { ApiError, setApiKey } from "@/lib/api/client"
import { apiKeyKeys } from "@/lib/api/query-keys"
import type { ApiKeyResponse, CreateApiKeyResponse } from "@/lib/api/types"

export function useApiKeys() {
  return useQuery({
    queryKey: apiKeyKeys.all,
    queryFn: listApiKeys,
  })
}

export function useCreateApiKey() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (name: string) => createApiKey({ name }),
    onSuccess: (created: CreateApiKeyResponse) => {
      setApiKey(created.key)

      const listEntry: ApiKeyResponse = {
        id: created.id,
        name: created.name,
        prefix: created.prefix,
        created_at: created.created_at,
        last_used_at: null,
      }
      queryClient.setQueryData<ApiKeyResponse[]>(apiKeyKeys.all, (old) =>
        old ? [listEntry, ...old] : [listEntry],
      )
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Failed to create API key"
      addToast(message, "error")
    },
  })
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: apiKeyKeys.all })
      const previous = queryClient.getQueryData<ApiKeyResponse[]>(
        apiKeyKeys.all,
      )
      queryClient.setQueryData<ApiKeyResponse[]>(apiKeyKeys.all, (old) =>
        old?.filter((k) => k.id !== id),
      )
      return { previous }
    },
    onError: (error, _id, context) => {
      queryClient.setQueryData(apiKeyKeys.all, context?.previous)
      const message =
        error instanceof ApiError ? error.message : "Failed to revoke API key"
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all })
    },
  })
}

export function useBulkRevokeApiKeys() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => revokeApiKey(id)))
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: apiKeyKeys.all })
      const previous = queryClient.getQueryData<ApiKeyResponse[]>(
        apiKeyKeys.all,
      )
      const idSet = new Set(ids)
      queryClient.setQueryData<ApiKeyResponse[]>(apiKeyKeys.all, (old) =>
        old?.filter((k) => !idSet.has(k.id)),
      )
      return { previous }
    },
    onError: (error, _ids, context) => {
      queryClient.setQueryData(apiKeyKeys.all, context?.previous)
      const message =
        error instanceof ApiError ? error.message : "Failed to revoke API keys"
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all })
    },
  })
}
