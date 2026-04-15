import { useQuery } from "@tanstack/react-query"
import { snapshotKeys } from "@/lib/api/query-keys"
import { listSnapshotsAction } from "@/lib/api/snapshots-actions"

export function useSnapshots() {
  return useQuery({
    queryKey: snapshotKeys.all,
    queryFn: () => listSnapshotsAction(),
  })
}
