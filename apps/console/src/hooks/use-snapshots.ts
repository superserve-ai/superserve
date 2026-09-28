"use client"

import { useToast } from "@superserve/ui"
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { useQueryScope } from "@/components/query-provider"
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

export const UNCONFIRMED_MESSAGE =
  "Couldn't reach Superserve, so the snapshot may not have started. Check the list before relying on it."

const CREATE_SNAPSHOT_KEY = ["snapshots", "create"] as const

// Keep polling while a snapshot is being taken or deleted, and for as long as
// a take-snapshot request is in flight: its row may not exist yet.
function usePollWhileSettling() {
  const taking = useIsMutating({ mutationKey: CREATE_SNAPSHOT_KEY }) > 0
  return (query: { state: { data?: SnapshotResponse[] } }): number | false => {
    const settling = query.state.data?.some(
      (s) => s.status === "creating" || s.status === "deleting",
    )
    return taking || settling ? 2000 : false
  }
}

/** Whether a take-snapshot request for this sandbox is in flight. */
export function useIsTakingSnapshot(sandboxId?: string): boolean {
  return (
    useIsMutating({
      mutationKey: CREATE_SNAPSHOT_KEY,
      predicate: (m) =>
        (m.state.variables as { sandboxId?: string } | undefined)?.sandboxId ===
        sandboxId,
    }) > 0
  )
}

/**
 * A capture that outlives the request (our timeout, a gateway timeout) keeps
 * running on the platform, so it is not a failure. A network error is not
 * counted: it can mean the request never reached the platform at all.
 */
export function isSnapshotStillBeingTaken(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 504
  return error instanceof DOMException && error.name === "AbortError"
}

export function useSnapshots({ enabled = true }: { enabled?: boolean } = {}) {
  const refetchInterval = usePollWhileSettling()
  const queryScope = useQueryScope()
  return useQuery({
    queryKey: [...snapshotKeys.lists(), queryScope],
    queryFn: () => listSnapshotsAction(),
    refetchInterval,
    enabled,
  })
}

export function useSandboxSnapshots(sandboxId: string) {
  const refetchInterval = usePollWhileSettling()
  const queryScope = useQueryScope()
  return useQuery({
    queryKey: [...snapshotKeys.bySandbox(sandboxId), queryScope],
    queryFn: () => listSandboxSnapshots(sandboxId),
    refetchInterval,
  })
}

export function useCreateSnapshot() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationKey: CREATE_SNAPSHOT_KEY,
    mutationFn: ({ sandboxId, name }: { sandboxId: string; name?: string }) =>
      createSnapshot(sandboxId, { name }),
    onSuccess: (snapshot) => {
      if (snapshot.status === "ready") addToast("Snapshot saved", "success")
      else addToast(STILL_TAKING_MESSAGE, "info")
    },
    onError: (error) => {
      if (isSnapshotStillBeingTaken(error)) {
        addToast(STILL_TAKING_MESSAGE, "info")
        return
      }
      if (error instanceof TypeError) {
        addToast(UNCONFIRMED_MESSAGE, "error")
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
