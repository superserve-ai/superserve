"use client"

import { CubeIcon } from "@phosphor-icons/react"
import {
  Badge,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useRouter } from "next/navigation"

import { EmptyState } from "@/components/empty-state"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import type { SecretSandboxBinding } from "@/lib/api/types"
import { STATUS_BADGE_VARIANT, STATUS_LABEL } from "@/lib/sandbox-utils"

interface SecretSandboxesPanelProps {
  bindings: SecretSandboxBinding[] | undefined
  isPending: boolean
}

export function SecretSandboxesPanel({
  bindings,
  isPending,
}: SecretSandboxesPanelProps) {
  const router = useRouter()

  return (
    <>
      <div className="flex h-10 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">Used by</h2>
      </div>
      {isPending ? (
        <div className="border-b border-border">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-6 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div className="h-3 w-32 animate-pulse bg-muted/20" />
              <div className="h-3 w-24 animate-pulse bg-muted/20" />
              <div className="h-3 w-16 animate-pulse bg-muted/20" />
            </div>
          ))}
        </div>
      ) : !bindings || bindings.length === 0 ? (
        <div className="border-b border-border py-10">
          <EmptyState
            icon={CubeIcon}
            title="Not in use"
            description="Sandboxes bound to this secret will appear here."
          />
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto border-b border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Sandbox</TableHead>
                <TableHead className="w-[35%]">Env var</TableHead>
                <TableHead className="w-[25%]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <StickyHoverTableBody>
              {bindings.map((binding) => (
                <TableRow
                  key={`${binding.sandbox_id}-${binding.env_key}`}
                  className="cursor-pointer"
                  onClick={() =>
                    router.push(`/sandboxes/${binding.sandbox_id}`)
                  }
                >
                  <TableCell className="text-foreground/80">
                    {binding.sandbox_name}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted">
                    {binding.env_key}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANT[binding.status]} dot>
                      {STATUS_LABEL[binding.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </StickyHoverTableBody>
          </Table>
        </div>
      )}
    </>
  )
}
