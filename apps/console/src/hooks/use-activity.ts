import { useQuery } from "@tanstack/react-query"
import { listActivityAction } from "@/lib/api/activity-actions"
import { auditLogKeys } from "@/lib/api/query-keys"

export function useActivity(limit = 100) {
  return useQuery({
    queryKey: auditLogKeys.all,
    queryFn: () => listActivityAction(limit),
  })
}
