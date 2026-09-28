import { CameraIcon } from "@phosphor-icons/react"
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"

import { AnimatedTableRow } from "@/components/animated-table-row"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { SnapshotRowActions } from "@/components/snapshots/snapshot-row-actions"
import {
  SnapshotStatusBadge,
  snapshotLabel,
  snapshotSize,
} from "@/components/snapshots/snapshot-status-badge"
import { TakeSnapshotDialog } from "@/components/snapshots/take-snapshot-dialog"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TemplateResources } from "@/components/templates/template-resources"
import { useSandboxSnapshots } from "@/hooks/use-snapshots"
import type { SandboxResponse } from "@/lib/api/types"
import { formatTime } from "@/lib/format"

export function SnapshotsSection({ sandbox }: { sandbox: SandboxResponse }) {
  const {
    data: snapshots,
    isPending,
    error,
    refetch,
  } = useSandboxSnapshots(sandbox.id)

  return (
    <div className="border-b border-border">
      <div className="flex h-10 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">Snapshots</h2>
        <TakeSnapshotDialog sandboxId={sandbox.id} status={sandbox.status} />
      </div>
      {isPending ? (
        <div>
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-6 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div className="h-3 w-32 animate-pulse bg-muted/20" />
              <div className="h-3 w-16 animate-pulse bg-muted/20" />
              <div className="h-3 w-16 animate-pulse bg-muted/20" />
              <div className="h-3 w-20 animate-pulse bg-muted/20" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : !snapshots || snapshots.length === 0 ? (
        <div className="flex min-h-60 items-center justify-center py-10">
          <EmptyState
            icon={CameraIcon}
            title="No Snapshots"
            description="Take a snapshot to save this sandbox's memory and disk. New sandboxes created from it start right where it left off."
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%]">Name</TableHead>
              <TableHead className="w-[14%]">Status</TableHead>
              <TableHead className="w-[14%]">Size</TableHead>
              <TableHead className="w-[24%]">Resources</TableHead>
              <TableHead className="w-[14%]">Created</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <StickyHoverTableBody>
            {snapshots.map((snapshot) => {
              const created = formatTime(new Date(snapshot.created_at))
              return (
                <AnimatedTableRow key={snapshot.id}>
                  <TableCell
                    className="font-mono text-foreground/80"
                    title={snapshot.id}
                  >
                    {snapshotLabel(snapshot)}
                  </TableCell>
                  <TableCell>
                    <SnapshotStatusBadge status={snapshot.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted tabular-nums">
                    {snapshotSize(snapshot)}
                  </TableCell>
                  <TableCell>
                    <TemplateResources
                      vcpu={snapshot.resources.vcpu_count}
                      memoryMib={snapshot.resources.memory_mib}
                      diskMib={snapshot.resources.disk_mib}
                    />
                  </TableCell>
                  <TableCell
                    className="text-xs text-muted tabular-nums"
                    title={created.absolute}
                  >
                    {created.relative}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <SnapshotRowActions snapshot={snapshot} />
                    </div>
                  </TableCell>
                </AnimatedTableRow>
              )
            })}
          </StickyHoverTableBody>
        </Table>
      )}
    </div>
  )
}
