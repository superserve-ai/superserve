"use client"

import { useToast } from "@superserve/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"
import { secretKeys } from "@/lib/api/query-keys"
import {
  createSecret,
  deleteSecret,
  getSecret,
  getSecretAudit,
  getSecretSandboxes,
  listSecrets,
  updateSecretValue,
} from "@/lib/api/secrets"
import type {
  AuditStatusFilter,
  CreateSecretRequest,
  SecretResponse,
  UpdateSecretRequest,
} from "@/lib/api/types"

export const AUDIT_PAGE_SIZE = 50

export function useSecrets() {
  return useQuery({
    queryKey: secretKeys.lists(),
    queryFn: listSecrets,
  })
}

export function useSecret(name: string | undefined) {
  return useQuery({
    queryKey: secretKeys.detail(name),
    queryFn: () => getSecret(name!),
    enabled: Boolean(name),
  })
}

export function useCreateSecret() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (data: CreateSecretRequest) => createSecret(data),
    onSuccess: (created: SecretResponse) => {
      queryClient.setQueryData<SecretResponse[]>(secretKeys.lists(), (prev) =>
        prev ? [created, ...prev] : [created],
      )
      queryClient.invalidateQueries({ queryKey: secretKeys.lists() })
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to create secret. Try again or contact support."
      addToast(message, "error")
    },
  })
}

export function useUpdateSecretValue(name: string) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (data: UpdateSecretRequest) => updateSecretValue(name, data),
    onSuccess: (updated) => {
      queryClient.setQueryData(secretKeys.detail(name), updated)
      queryClient.invalidateQueries({ queryKey: secretKeys.lists() })
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to rotate secret. Try again or contact support."
      addToast(message, "error")
    },
  })
}

export function useDeleteSecret() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (name: string) => deleteSecret(name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: secretKeys.lists() })
      const previous = queryClient.getQueryData<SecretResponse[]>(
        secretKeys.lists(),
      )
      queryClient.setQueryData<SecretResponse[]>(
        secretKeys.lists(),
        (prev) => prev?.filter((s) => s.name !== name) ?? [],
      )
      return { previous }
    },
    onError: (error, _name, context) => {
      if (context?.previous) {
        queryClient.setQueryData(secretKeys.lists(), context.previous)
      }
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to delete secret. It may have already been removed."
      addToast(message, "error")
    },
    onSettled: (_data, _error, name) => {
      queryClient.invalidateQueries({ queryKey: secretKeys.detail(name) })
      queryClient.invalidateQueries({ queryKey: secretKeys.lists() })
    },
  })
}

export function useSecretAudit(
  name: string | undefined,
  params?: { status?: AuditStatusFilter },
) {
  return useQuery({
    queryKey: secretKeys.audit(name, { status: params?.status }),
    queryFn: () =>
      getSecretAudit(name!, {
        limit: AUDIT_PAGE_SIZE,
        status: params?.status,
      }),
    enabled: Boolean(name),
  })
}

export function useSecretSandboxes(name: string | undefined) {
  return useQuery({
    queryKey: secretKeys.sandboxes(name),
    queryFn: () => getSecretSandboxes(name!),
    enabled: Boolean(name),
  })
}
