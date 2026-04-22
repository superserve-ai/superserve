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
  patchSandbox,
  pauseSandbox,
  resumeSandbox,
} from "@/lib/api/sandboxes"
import type {
  CreateSandboxRequest,
  SandboxListItem,
  SandboxPatch,
  SandboxResponse,
} from "@/lib/api/types"

export function useSandboxes() {
  return useQuery({
    queryKey: sandboxKeys.all,
    queryFn: listSandboxes,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  })
}

export function useSandbox(id: string | null) {
  return useQuery({
    queryKey: sandboxKeys.detail(id ?? ""),
    queryFn: () => getSandbox(id as string),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "resuming" ? 2000 : false
    },
    refetchOnWindowFocus: true,
  })
}

export function useCreateSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (data: CreateSandboxRequest) => createSandbox(data),
    onSuccess: (newSandbox) => {
      queryClient.setQueryData<SandboxListItem[]>(sandboxKeys.all, (old) =>
        old ? [newSandbox, ...old] : [newSandbox],
      )
      addToast(`Sandbox "${newSandbox.name}" created`, "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to create sandbox. Check your plan limits or try again."
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
      const previous = queryClient.getQueryData<SandboxListItem[]>(
        sandboxKeys.all,
      )
      queryClient.setQueryData<SandboxListItem[]>(sandboxKeys.all, (old) =>
        old?.filter((s) => s.id !== id),
      )
      return { previous }
    },
    onError: (error, _id, context) => {
      queryClient.setQueryData(sandboxKeys.all, context?.previous)
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to delete sandbox. The sandbox may already be deleted."
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
      const previous = queryClient.getQueryData<SandboxListItem[]>(
        sandboxKeys.all,
      )
      const idSet = new Set(ids)
      queryClient.setQueryData<SandboxListItem[]>(sandboxKeys.all, (old) =>
        old?.filter((s) => !idSet.has(s.id)),
      )
      return { previous }
    },
    onError: (error, _ids, context) => {
      queryClient.setQueryData(sandboxKeys.all, context?.previous)
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to delete sandboxes. Some may have already been deleted."
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
      const previousList = queryClient.getQueryData<SandboxListItem[]>(
        sandboxKeys.all,
      )
      const previousDetail = queryClient.getQueryData<SandboxResponse>(
        sandboxKeys.detail(id),
      )
      queryClient.setQueryData<SandboxListItem[]>(sandboxKeys.all, (old) =>
        old?.map((s) =>
          s.id === id ? { ...s, status: "paused" as const } : s,
        ),
      )
      queryClient.setQueryData<SandboxResponse>(
        sandboxKeys.detail(id),
        (old) => (old ? { ...old, status: "paused" as const } : old),
      )
      return { previousList, previousDetail }
    },
    onError: (error, id, context) => {
      if (context?.previousList !== undefined) {
        queryClient.setQueryData(sandboxKeys.all, context.previousList)
      }
      if (context?.previousDetail !== undefined) {
        queryClient.setQueryData(sandboxKeys.detail(id), context.previousDetail)
      }
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to pause sandbox. It may have already stopped."
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
      const previousList = queryClient.getQueryData<SandboxListItem[]>(
        sandboxKeys.all,
      )
      const previousDetail = queryClient.getQueryData<SandboxResponse>(
        sandboxKeys.detail(id),
      )
      queryClient.setQueryData<SandboxListItem[]>(sandboxKeys.all, (old) =>
        old?.map((s) =>
          s.id === id ? { ...s, status: "resuming" as const } : s,
        ),
      )
      queryClient.setQueryData<SandboxResponse>(
        sandboxKeys.detail(id),
        (old) => (old ? { ...old, status: "resuming" as const } : old),
      )
      return { previousList, previousDetail }
    },
    onSuccess: (resumed, id) => {
      // Server returns a fresh access_token with the resume response — write
      // it into the detail cache so the terminal and file-transfer panels
      // pick up the new token without waiting for a refetch.
      queryClient.setQueryData<SandboxResponse>(
        sandboxKeys.detail(id),
        (old) =>
          old
            ? {
                ...old,
                status: resumed.status,
                access_token: resumed.access_token,
              }
            : old,
      )
      queryClient.setQueryData<SandboxListItem[]>(sandboxKeys.all, (old) =>
        old?.map((s) => (s.id === id ? { ...s, status: resumed.status } : s)),
      )
    },
    onError: (error, id, context) => {
      if (context?.previousList !== undefined) {
        queryClient.setQueryData(sandboxKeys.all, context.previousList)
      }
      if (context?.previousDetail !== undefined) {
        queryClient.setQueryData(sandboxKeys.detail(id), context.previousDetail)
      }
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to resume sandbox. Check that it hasn't been deleted."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}

export function usePatchSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SandboxPatch }) =>
      patchSandbox(id, data),
    onSuccess: () => {
      addToast("Sandbox updated", "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Failed to update sandbox."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}
