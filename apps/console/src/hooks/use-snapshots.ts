import { useQuery } from "@tanstack/react-query"
import { listSnapshotsAction } from "@/lib/api/snapshots-actions"
import { snapshotKeys } from "@/lib/api/query-keys"

export function useSnapshots() {
  return useQuery({
    queryKey: snapshotKeys.all,
    queryFn: () => listSnapshotsAction(),
  })
}
