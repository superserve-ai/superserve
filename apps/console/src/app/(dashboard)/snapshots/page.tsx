"use client"

import { CameraIcon, DotsThreeVerticalIcon } from "@phosphor-icons/react"
import {
  Checkbox,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableToolbar } from "@/components/table-toolbar"

interface Snapshot {
  id: string
  name: string
  created: string
  lastUsed: string
}

const MOCK_SNAPSHOTS: Snapshot[] = [
  {
    id: "1",
    name: "superserve-agent-sandbox",
    created: "-",
    lastUsed: "-",
  },
  {
    id: "2",
    name: "dc703f84-a11e-43bf-90db-af2f8a46cf1c",
    created: "-",
    lastUsed: "-",
  },
  {
    id: "3",
    name: "dc703f84-a11e-43bf-90db-af2f8a46cf1c",
    created: "-",
    lastUsed: "-",
  },
  {
    id: "4",
    name: "dc703f84-a11e-43bf-90db-af2f8a46cf1c",
    created: "-",
    lastUsed: "-",
  },
]

export default function SnapshotsPage() {
  const [snapshots] = useState<Snapshot[]>(MOCK_SNAPSHOTS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!search) return snapshots
    return snapshots.filter((s) =>
      s.name.toLowerCase().includes(search.toLowerCase()),
    )
  }, [snapshots, search])

  const allSelected = filtered.length > 0 && selected.size === filtered.length
  const someSelected = selected.size > 0 && !allSelected

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((s) => s.id)))
    }
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const isEmpty = snapshots.length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between h-14 border-b border-border px-6">
        <h1 className="text-lg font-medium tracking-tight text-foreground">
          Snapshots
        </h1>
      </div>

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
                      />
                    </TableCell>
                    <TableCell className="font-mono text-foreground/80">
                      {snapshot.name}
                    </TableCell>
                    <TableCell className="text-muted">
                      {snapshot.created}
                    </TableCell>
                    <TableCell className="text-muted">
                      {snapshot.lastUsed}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="p-1.5 text-muted hover:text-foreground transition-colors cursor-pointer"
                      >
                        <DotsThreeVerticalIcon
                          className="size-4"
                          weight="bold"
                        />
                      </button>
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
