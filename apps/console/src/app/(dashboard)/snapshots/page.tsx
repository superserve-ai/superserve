"use client"

import { CameraIcon } from "@phosphor-icons/react"
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useMemo, useState } from "react"

import { AnimatedTableRow } from "@/components/animated-table-row"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { SnapshotRowActions } from "@/components/snapshots/snapshot-row-actions"
import {
  SnapshotStatusBadge,
  snapshotLabel,
} from "@/components/snapshots/snapshot-status-badge"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { TemplateResources } from "@/components/templates/template-resources"
import { useSnapshots } from "@/hooks/use-snapshots"
import { formatTime } from "@/lib/format"
import { formatBytes } from "@/lib/sandbox-utils"

export default function SnapshotsPage() {
  return (
    <Suspense fallback={<TableSkeleton columns={7} />}>
      <SnapshotsPageContent />
    </Suspense>
  )
}

function SnapshotsPageContent() {
  const searchParams = useSearchParams()
  const { data: snapshots, isPending, error, refetch } = useSnapshots()
  // ?q= lets a sandbox link straight to the snapshot it was created from.
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "")

  const filtered = useMemo(() => {
    if (!snapshots) return []
    if (!search) return snapshots
    const q = search.toLowerCase()
    return snapshots.filter(
      (s) =>
        s.id.startsWith(q) ||
        s.name?.toLowerCase().includes(q) ||
        s.sandbox_name?.toLowerCase().includes(q) ||
        s.sandbox_id.startsWith(q),
    )
  }, [snapshots, search])

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Snapshots" />
        <TableSkeleton columns={7} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Snapshots" />
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Snapshots" />

      {snapshots.length === 0 ? (
        <EmptyState
          icon={CameraIcon}
          title="No Snapshots"
          description="Take a snapshot of a sandbox to save its memory and disk; new sandboxes created from it continue with its processes running."
        />
      ) : (
        <>
          <TableToolbar
            id="snapshots-toolbar"
            searchPlaceholder="Search by name or sandbox…"
            searchValue={search}
            onSearchChange={setSearch}
          />

          <div className="flex flex-1 flex-col overflow-y-auto">
            {filtered.length === 0 ? (
              <EmptyState
                icon={CameraIcon}
                title="No snapshots match that search"
                description="Try a different name."
              />
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
                  <TableRow>
                    <TableHead className="w-[22%]">Name</TableHead>
                    <TableHead className="w-[18%]">Sandbox</TableHead>
                    <TableHead className="w-[11%]">Status</TableHead>
                    <TableHead className="w-[10%]">Size</TableHead>
                    <TableHead className="w-[22%]">Resources</TableHead>
                    <TableHead className="w-[11%]">Created</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <StickyHoverTableBody>
                  {filtered.map((snapshot) => {
                    const created = formatTime(new Date(snapshot.created_at))
                    return (
                      <AnimatedTableRow key={snapshot.id}>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-foreground/80">
                              {snapshotLabel(snapshot)}
                            </span>
                            <span
                              className="font-mono text-[10px] text-muted tabular-nums"
                              title={snapshot.id}
                            >
                              {snapshot.id.slice(0, 8)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {snapshot.sandbox_name ? (
                            <Link
                              href={`/sandboxes/${snapshot.sandbox_id}/`}
                              className="text-foreground/80 underline-offset-2 hover:underline"
                            >
                              {snapshot.sandbox_name}
                            </Link>
                          ) : (
                            <span
                              className="text-muted"
                              title={`${snapshot.sandbox_id} (deleted)`}
                            >
                              {snapshot.sandbox_id.slice(0, 8)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <SnapshotStatusBadge status={snapshot.status} />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted tabular-nums">
                          {formatBytes(snapshot.size_bytes)}
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
        </>
      )}
    </div>
  )
}
