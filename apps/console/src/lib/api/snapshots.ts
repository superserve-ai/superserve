import { apiClient } from "./client"
import type { SnapshotResponse } from "./types"

// A large first capture can take minutes; the default 30s would abort it.
const CREATE_SNAPSHOT_TIMEOUT_MS = 5 * 60_000

export async function createSnapshot(
  sandboxId: string,
  data: { name?: string } = {},
): Promise<SnapshotResponse> {
  return apiClient<SnapshotResponse>(
    `/sandboxes/${sandboxId}/snapshot`,
    {
      method: "POST",
      body: JSON.stringify({
        kind: "mem+fs",
        ...(data.name ? { name: data.name } : {}),
        idempotency_key: crypto.randomUUID(),
      }),
    },
    CREATE_SNAPSHOT_TIMEOUT_MS,
  )
}

export async function listSandboxSnapshots(
  sandboxId: string,
): Promise<SnapshotResponse[]> {
  return apiClient<SnapshotResponse[]>(`/sandboxes/${sandboxId}/snapshots`)
}

export async function renameSnapshot(
  id: string,
  name: string,
): Promise<SnapshotResponse> {
  return apiClient<SnapshotResponse>(`/snapshots/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  })
}

/** Resolves on 204 and on 202, where the removal finishes shortly. */
export async function deleteSnapshot(id: string): Promise<void> {
  await apiClient<unknown>(`/snapshots/${id}`, { method: "DELETE" })
}
