import { CameraIcon } from "@phosphor-icons/react"
import {
  Badge,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { EmptyState } from "@/components/empty-state"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import type { SnapshotResponse } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { formatBytes } from "@/lib/sandbox-utils"

interface SnapshotsSectionProps {
  snapshots: SnapshotResponse[] | undefined
  isPending: boolean
}

export function SnapshotsSection({
  snapshots,
  isPending,
}: SnapshotsSectionProps) {
  return (
    <>
      <div className="flex h-10 items-center border-b border-border px-4">
        <h2 className="text-sm font-medium text-foreground">Snapshots</h2>
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
      ) : !snapshots || snapshots.length === 0 ? (
        <div className="flex min-h-60 items-center justify-center py-10">
          <EmptyState
            icon={CameraIcon}
            title="No Snapshots"
            description="Snapshots are created when you pause this sandbox to preserve its state."
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[35%]">Name</TableHead>
              <TableHead className="w-[15%]">Size</TableHead>
              <TableHead className="w-[15%]">Trigger</TableHead>
              <TableHead className="w-[10%]">Saved</TableHead>
              <TableHead className="w-[25%]">Created</TableHead>
            </TableRow>
          </TableHeader>
          <StickyHoverTableBody>
            {snapshots.map((snapshot) => (
              <TableRow key={snapshot.id}>
                <TableCell className="font-mono text-foreground/80">
                  {snapshot.name ?? `${snapshot.id.slice(0, 12)}...`}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted tabular-nums">
                  {formatBytes(snapshot.size_bytes)}
                </TableCell>
                <TableCell className="capitalize text-foreground/80">
                  {snapshot.trigger}
                </TableCell>
                <TableCell>
                  <Badge variant={snapshot.saved ? "success" : "muted"} dot>
                    {snapshot.saved ? "Yes" : "No"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted tabular-nums">
                  {formatDate(new Date(snapshot.created_at))}
                </TableCell>
              </TableRow>
            ))}
          </StickyHoverTableBody>
        </Table>
      )}
    </>
  )
}
