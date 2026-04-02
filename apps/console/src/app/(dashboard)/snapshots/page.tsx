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
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableToolbar } from "@/components/table-toolbar"
import { useSelection } from "@/hooks/use-selection"
import { formatDate } from "@/lib/format"

interface Snapshot {
  id: string
  name: string
  created: Date | null
  lastUsed: Date | null
}

const MOCK_SNAPSHOTS: Snapshot[] = [
  {
    id: "1",
    name: "superserve-agent-sandbox",
    created: null,
    lastUsed: null,
  },
  {
    id: "2",
    name: "dc703f84-a11e-43bf-90db-af2f8a46cf1c",
    created: null,
    lastUsed: null,
  },
  {
    id: "3",
    name: "dc703f84-a11e-43bf-90db-af2f8a46cf1c",
    created: null,
    lastUsed: null,
  },
  {
    id: "4",
    name: "dc703f84-a11e-43bf-90db-af2f8a46cf1c",
    created: null,
    lastUsed: null,
  },
]

export default function SnapshotsPage() {
  const [snapshots] = useState<Snapshot[]>(MOCK_SNAPSHOTS)
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!search) return snapshots
    return snapshots.filter((s) =>
      s.name.toLowerCase().includes(search.toLowerCase()),
    )
  }, [snapshots, search])

  const { selected, allSelected, someSelected, toggleAll, toggleOne } =
    useSelection(filtered)

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
                      checked={someSelected ? "indeterminate" : allSelected}
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
                      {snapshot.created ? formatDate(snapshot.created) : "-"}
                    </TableCell>
                    <TableCell className="text-muted">
                      {snapshot.lastUsed ? formatDate(snapshot.lastUsed) : "-"}
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
