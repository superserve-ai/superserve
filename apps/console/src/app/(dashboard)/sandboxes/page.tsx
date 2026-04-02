"use client"

import {
  CubeIcon,
  DotsThreeVerticalIcon,
  KeyIcon,
  KeyReturnIcon,
  PlayIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Badge,
  type BadgeVariant,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { CreateSandboxDialog } from "@/components/sandboxes/create-sandbox-dialog"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableToolbar } from "@/components/table-toolbar"
import { useSelection } from "@/hooks/use-selection"

type SandboxStatus = "Ready" | "Stopped" | "Paused"

interface Sandbox {
  id: string
  name: string
  status: SandboxStatus
  snapshot: string
  resources: string
}

const STATUS_BADGE_VARIANT: Record<SandboxStatus, BadgeVariant> = {
  Ready: "success",
  Stopped: "destructive",
  Paused: "muted",
}

const MOCK_SANDBOXES: Sandbox[] = [
  {
    id: "1",
    name: "dc703f84-a11e-43bf-90db-af2f8a46cf1c",
    status: "Ready",
    snapshot: "superserve/snap-43",
    resources: "1CPU | 2GB | 3GB",
  },
  {
    id: "2",
    name: "dc703f84-a11e-43bf-90db-af2f8a46cf1c",
    status: "Stopped",
    snapshot: "superserve/snap-32",
    resources: "1CPU | 2GB | 3GB",
  },
  {
    id: "3",
    name: "dc703f84-a11e-43bf-90db-af2f8a46cf1c",
    status: "Paused",
    snapshot: "superserve/snap-12",
    resources: "1CPU | 2GB | 3GB",
  },
]

const STATUS_TABS = [
  { label: "All", value: "all" },
  { label: "Ready", value: "Ready" },
  { label: "Stopped", value: "Stopped" },
  { label: "Paused", value: "Paused" },
]

export default function SandboxesPage() {
  const [sandboxes, setSandboxes] = useState<Sandbox[]>(MOCK_SANDBOXES)
  const [statusFilter, setStatusFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)

  const filtered = useMemo(() => {
    return sandboxes.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false
      if (search && !s.name.toLowerCase().includes(search.toLowerCase()))
        return false
      return true
    })
  }, [sandboxes, statusFilter, search])

  const tabs = STATUS_TABS.map((tab) => ({
    ...tab,
    count:
      tab.value === "all"
        ? sandboxes.length
        : sandboxes.filter((s) => s.status === tab.value).length,
  }))

  const {
    selected,
    allSelected,
    someSelected,
    toggleAll,
    toggleOne,
    clearSelection,
  } = useSelection(filtered)

  const deleteSelected = () => {
    setSandboxes((prev) => prev.filter((s) => !selected.has(s.id)))
    clearSelection()
  }

  const isEmpty = sandboxes.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Sandboxes">
        {!isEmpty && (
          <CreateSandboxDialog open={createOpen} onOpenChange={setCreateOpen} />
        )}
      </PageHeader>

      {isEmpty ? (
        <>
          <EmptyState
            icon={CubeIcon}
            title="No Sandboxes"
            description="Create your first sandbox to start deploying agents."
            actionLabel="Create Sandbox"
            onAction={() => setCreateOpen(true)}
          />
          <CreateSandboxDialog open={createOpen} onOpenChange={setCreateOpen} />
        </>
      ) : (
        <>
          <TableToolbar
            tabs={tabs}
            activeTab={statusFilter}
            onTabChange={setStatusFilter}
            searchPlaceholder="Search sandboxes..."
            searchValue={search}
            onSearchChange={setSearch}
            selectedCount={selected.size}
            onClearSelection={clearSelection}
            onDeleteSelected={deleteSelected}
          />

          <div className="flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <Checkbox
                      checked={someSelected ? "indeterminate" : allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all sandboxes"
                    />
                  </TableHead>
                  <TableHead className="w-[30%]">Name</TableHead>
                  <TableHead className="w-[15%]">Status</TableHead>
                  <TableHead className="w-[20%]">Snapshot</TableHead>
                  <TableHead className="w-[15%]">Resources</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <StickyHoverTableBody>
                {filtered.map((sandbox) => (
                  <TableRow key={sandbox.id}>
                    <TableCell className="pr-0">
                      <Checkbox
                        checked={selected.has(sandbox.id)}
                        onCheckedChange={() => toggleOne(sandbox.id)}
                        aria-label={`Select ${sandbox.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-foreground/80">
                      {sandbox.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE_VARIANT[sandbox.status]} dot>
                        {sandbox.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {sandbox.snapshot}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted">
                      {sandbox.resources}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-20 text-xs"
                        >
                          {sandbox.status === "Ready" ? (
                            <>
                              <StopIcon className="size-3" weight="light" />
                              Stop
                            </>
                          ) : (
                            <>
                              <PlayIcon className="size-3" weight="light" />
                              Start
                            </>
                          )}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Sandbox actions"
                            >
                              <DotsThreeVerticalIcon
                                className="size-4"
                                weight="bold"
                              />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                              <TerminalIcon className="size-4" weight="light" />
                              Open Terminal
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <KeyIcon className="size-4" weight="light" />
                              Create SSH Access
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <KeyReturnIcon
                                className="size-4"
                                weight="light"
                              />
                              Remove SSH Access
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive hover:text-destructive">
                              <TrashIcon className="size-4" weight="light" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
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
