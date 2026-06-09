"use client"

import { useQuery } from "@tanstack/react-query"

import { proxyAuditKeys } from "@/lib/api/query-keys"
import { getSandboxAudit, type AuditQueryParams } from "@/lib/api/secrets"

/** Per-sandbox egress audit. Used by the sandbox-detail Egress audit tab. */
export function useSandboxAudit(
  sandboxId: string | undefined,
  params?: AuditQueryParams,
) {
  return useQuery({
    queryKey: sandboxId
      ? proxyAuditKeys.sandbox(sandboxId, { status: params?.status })
      : ["proxy-audit", "sandbox"],
    queryFn: () => getSandboxAudit(sandboxId as string, params),
    enabled: Boolean(sandboxId),
  })
}
