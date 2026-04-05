"use client"

import { CameraIcon, DotsThreeVerticalIcon } from "@phosphor-icons/react"
import {
  Button,
  Checkbox,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { useSelection } from "@/hooks/use-selection"
import { apiClient } from "@/lib/api/client"
import { snapshotKeys } from "@/lib/api/query-keys"
import { formatDate } from "@/lib/format"

interface Snapshot {
  id: string
  name: string
  created_at: string
  last_used_at: string | null
}

export default function SnapshotsPage() {
  const {
    data: snapshots,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: snapshotKeys.all,
    queryFn: () => apiClient<Snapshot[]>("/v1/snapshots"),
  })

  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!snapshots) return []
    if (!search) return snapshots
    return snapshots.filter((s) =>
      s.name.toLowerCase().includes(search.toLowerCase()),
    )
  }, [snapshots, search])

  const { selected, allSelected, someSelected, toggleAll, toggleOne } =
    useSelection(filtered)

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Snapshots" />
        <TableSkeleton columns={5} />
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

  const isEmpty = snapshots.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Snapshots" />

      {isEmpty ? (
        <EmptyState
          icon={CameraIcon}
          title="No Snapshots"
          description="Snapshots are created automatically when you deploy a sandbox."
        />
      ) : (
        <>
          <TableToolbar
            searchPlaceholder="Search snapshots..."
            searchValue={search}
            onSearchChange={setSearch}
          />

          <div className="flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all snapshots"
                    />
                  </TableHead>
                  <TableHead className="w-[40%]">Name</TableHead>
                  <TableHead className="w-[20%]">Created</TableHead>
                  <TableHead className="w-[20%]">Last Used</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <StickyHoverTableBody>
                {filtered.map((snapshot) => (
                  <TableRow key={snapshot.id}>
                    <TableCell className="pr-0">
                      <Checkbox
                        checked={selected.has(snapshot.id)}
                        onCheckedChange={() => toggleOne(snapshot.id)}
                        aria-label={`Select ${snapshot.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-foreground/80">
                      {snapshot.name}
                    </TableCell>
                    <TableCell className="text-muted">
                      {snapshot.created_at
                        ? formatDate(new Date(snapshot.created_at))
                        : "-"}
                    </TableCell>
                    <TableCell className="text-muted">
                      {snapshot.last_used_at
                        ? formatDate(new Date(snapshot.last_used_at))
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Snapshot actions"
                      >
                        <DotsThreeVerticalIcon
                          className="size-4"
                          weight="bold"
                        />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </StickyHoverTableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
