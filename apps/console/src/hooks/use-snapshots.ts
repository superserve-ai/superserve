"use client"

import { useToast } from "@superserve/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"
import { sandboxKeys, snapshotKeys } from "@/lib/api/query-keys"
import {
  createSnapshot,
  deleteSnapshot,
  listSandboxSnapshots,
  renameSnapshot,
} from "@/lib/api/snapshots"
import { listSnapshotsAction } from "@/lib/api/snapshots-actions"
import type { SnapshotResponse } from "@/lib/api/types"

export const STILL_TAKING_MESSAGE =
  "The snapshot is still being taken; it will appear here shortly"

// Keep polling while the platform settles a snapshot.
function pollWhileSettling(query: {
  state: { data?: SnapshotResponse[] }
}): number | false {
  const settling = query.state.data?.some(
    (s) => s.status === "creating" || s.status === "deleting",
  )
  return settling ? 2000 : false
}

/**
 * A capture that outlives the request (client timeout, dropped connection,
 * gateway timeout) keeps running on the platform, so it is not a failure.
 */
export function isSnapshotStillBeingTaken(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 504
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "AbortError")
  )
}

export function useSnapshots({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: snapshotKeys.lists(),
    queryFn: () => listSnapshotsAction(),
    refetchInterval: pollWhileSettling,
    enabled,
  })
}

export function useSandboxSnapshots(sandboxId: string) {
  return useQuery({
    queryKey: snapshotKeys.bySandbox(sandboxId),
    queryFn: () => listSandboxSnapshots(sandboxId),
    refetchInterval: pollWhileSettling,
  })
}

export function useCreateSnapshot() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: ({ sandboxId, name }: { sandboxId: string; name?: string }) =>
      createSnapshot(sandboxId, { name }),
    onMutate: () => {
      // The platform records the snapshot as `creating` before the capture
      // finishes; refetch once it has, so the row shows (and polls) meanwhile.
      setTimeout(
        () => queryClient.invalidateQueries({ queryKey: snapshotKeys.all }),
        1500,
      )
    },
    onSuccess: (snapshot) => {
      if (snapshot.status === "ready") addToast("Snapshot saved", "success")
      else addToast(STILL_TAKING_MESSAGE, "info")
    },
    onError: (error) => {
      if (isSnapshotStillBeingTaken(error)) {
        addToast(STILL_TAKING_MESSAGE, "info")
        return
      }
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to take snapshot. Try again or contact support."
      addToast(message, "error")
    },
    onSettled: (_data, _error, { sandboxId }) => {
      queryClient.invalidateQueries({ queryKey: snapshotKeys.all })
      // Capturing a running sandbox pauses it briefly.
      queryClient.invalidateQueries({ queryKey: sandboxKeys.detail(sandboxId) })
    },
  })
}

export function useRenameSnapshot() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameSnapshot(id, name),
    onSuccess: () => addToast("Snapshot renamed", "success"),
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to rename snapshot. Try again or contact support."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: snapshotKeys.all })
    },
  })
}

export function useDeleteSnapshot() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => deleteSnapshot(id),
    onSuccess: () => addToast("Snapshot deleted", "success"),
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to delete snapshot. It may have already been removed."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: snapshotKeys.all })
    },
  })
}
