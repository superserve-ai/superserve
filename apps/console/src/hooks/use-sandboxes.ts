"use client"

import { useToast } from "@superserve/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError } from "@/lib/api/client"
import { sandboxKeys } from "@/lib/api/query-keys"
import {
  createSandbox,
  deleteSandbox,
  getSandbox,
  listSandboxes,
  pauseSandbox,
  resumeSandbox,
} from "@/lib/api/sandboxes"
import type { CreateSandboxRequest, SandboxResponse } from "@/lib/api/types"

export function useSandboxes() {
  return useQuery({
    queryKey: sandboxKeys.all,
    queryFn: listSandboxes,
  })
}

export function useSandbox(id: string | null) {
  return useQuery({
    queryKey: sandboxKeys.detail(id ?? ""),
    queryFn: () => getSandbox(id as string),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "starting" || status === "pausing" ? 2000 : false
    },
  })
}

export function useCreateSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (data: CreateSandboxRequest) => createSandbox(data),
    onSuccess: (newSandbox) => {
      queryClient.setQueryData<SandboxResponse[]>(sandboxKeys.all, (old) =>
        old ? [newSandbox, ...old] : [newSandbox],
      )
      addToast(`Sandbox "${newSandbox.name}" is starting`, "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Failed to create sandbox"
      addToast(message, "error")
    },
  })
}

export function useDeleteSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => deleteSandbox(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: sandboxKeys.all })
      const previous = queryClient.getQueryData<SandboxResponse[]>(
        sandboxKeys.all,
      )
      queryClient.setQueryData<SandboxResponse[]>(sandboxKeys.all, (old) =>
        old?.filter((s) => s.id !== id),
      )
      return { previous }
    },
    onError: (error, _id, context) => {
      queryClient.setQueryData(sandboxKeys.all, context?.previous)
      const message =
        error instanceof ApiError ? error.message : "Failed to delete sandbox"
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}

export function useBulkDeleteSandboxes() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteSandbox(id)))
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: sandboxKeys.all })
      const previous = queryClient.getQueryData<SandboxResponse[]>(
        sandboxKeys.all,
      )
      const idSet = new Set(ids)
      queryClient.setQueryData<SandboxResponse[]>(sandboxKeys.all, (old) =>
        old?.filter((s) => !idSet.has(s.id)),
      )
      return { previous }
    },
    onError: (error, _ids, context) => {
      queryClient.setQueryData(sandboxKeys.all, context?.previous)
      const message =
        error instanceof ApiError ? error.message : "Failed to delete sandboxes"
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}

export function usePauseSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => pauseSandbox(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: sandboxKeys.all })
      const previous = queryClient.getQueryData<SandboxResponse[]>(
        sandboxKeys.all,
      )
      queryClient.setQueryData<SandboxResponse[]>(sandboxKeys.all, (old) =>
        old?.map((s) => (s.id === id ? { ...s, status: "idle" as const } : s)),
      )
      return { previous }
    },
    onError: (error, _id, context) => {
      queryClient.setQueryData(sandboxKeys.all, context?.previous)
      const message =
        error instanceof ApiError ? error.message : "Failed to pause sandbox"
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}

export function useResumeSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => resumeSandbox(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: sandboxKeys.all })
      const previous = queryClient.getQueryData<SandboxResponse[]>(
        sandboxKeys.all,
      )
      queryClient.setQueryData<SandboxResponse[]>(sandboxKeys.all, (old) =>
        old?.map((s) =>
          s.id === id ? { ...s, status: "active" as const } : s,
        ),
      )
      return { previous }
    },
    onError: (error, _id, context) => {
      queryClient.setQueryData(sandboxKeys.all, context?.previous)
      const message =
        error instanceof ApiError ? error.message : "Failed to resume sandbox"
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}
