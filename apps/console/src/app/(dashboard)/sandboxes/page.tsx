"use client"

import {
  CubeIcon,
  DotsThreeVerticalIcon,
  KeyIcon,
  KeyReturnIcon,
  PlayIcon,
  PlugIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Badge,
  type BadgeVariant,
  Button,
  Checkbox,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useRouter } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { ConnectSandboxDialog } from "@/components/sandboxes/connect-sandbox-dialog"
import { CreateSandboxDialog } from "@/components/sandboxes/create-sandbox-dialog"
import { DeleteSandboxDialog } from "@/components/sandboxes/delete-sandbox-dialog"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import {
  useBulkDeleteSandboxes,
  useDeleteSandbox,
  usePauseSandbox,
  useResumeSandbox,
  useSandboxes,
} from "@/hooks/use-sandboxes"
import { useSelection } from "@/hooks/use-selection"
import type { SandboxStatus } from "@/lib/api/types"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"

const STATUS_BADGE_VARIANT: Record<SandboxStatus, BadgeVariant> = {
  active: "success",
  pausing: "warning",
  idle: "muted",
  deleted: "destructive",
  failed: "destructive",
}

const STATUS_LABEL: Record<SandboxStatus, string> = {
  active: "Active",
  pausing: "Pausing",
  idle: "Idle",
  deleted: "Deleted",
  failed: "Failed",
}

const STATUS_TABS = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Idle", value: "idle" },
]

export default function SandboxesPage() {
  const router = useRouter()
  const posthog = usePostHog()
  const [statusFilter, setStatusFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [connectSandboxId, setConnectSandboxId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    name: string
  } | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const { data: sandboxes = [], isPending, error, refetch } = useSandboxes()
  const deleteSandbox = useDeleteSandbox()
  const bulkDelete = useBulkDeleteSandboxes()
  const pauseMutation = usePauseSandbox()
  const resumeMutation = useResumeSandbox()

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

  const isEmpty = !isPending && !error && sandboxes.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Sandboxes">
        <CreateSandboxDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          hideTrigger={isEmpty || isPending}
          onCreated={(id) => setConnectSandboxId(id)}
        />
      </PageHeader>

      {isPending ? (
        <TableSkeleton columns={6} tabs={4} />
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : isEmpty ? (
        <EmptyState
          icon={CubeIcon}
          title="No Sandboxes"
          description="Create your first sandbox to start deploying agents."
          actionLabel="Create Sandbox"
          onAction={() => setCreateOpen(true)}
        />
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
            onDeleteSelected={() => setBulkDeleteOpen(true)}
          />

          <div className="flex-1 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
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
                  <TableRow
                    key={sandbox.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/sandboxes/${sandbox.id}/`)}
                  >
                    <TableCell
                      className="pr-0"
                      onClick={(e) => e.stopPropagation()}
                    >
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
                        {STATUS_LABEL[sandbox.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {sandbox.snapshot_id
                        ? `${sandbox.snapshot_id.slice(0, 8)}...`
                        : "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted">
                      {sandbox.vcpu_count}CPU | {sandbox.memory_mib}MB
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => setConnectSandboxId(sandbox.id)}
                        >
                          <PlugIcon className="size-3.5" weight="light" />
                          Connect
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-20 text-xs"
                          disabled={
                            sandbox.status === "pausing" ||
                            sandbox.status === "failed"
                          }
                          onClick={() => {
                            if (sandbox.status === "active") {
                              pauseMutation.mutate(sandbox.id)
                            } else if (sandbox.status === "idle") {
                              resumeMutation.mutate(sandbox.id)
                            }
                          }}
                        >
                          {sandbox.status === "active" ||
                          sandbox.status === "pausing" ? (
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
                        <Menu>
                          <MenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Sandbox actions"
                              />
                            }
                          >
                            <DotsThreeVerticalIcon
                              className="size-4"
                              weight="bold"
                            />
                          </MenuTrigger>
                          <MenuPopup>
                            <MenuItem
                              onClick={() => setConnectSandboxId(sandbox.id)}
                            >
                              <PlugIcon className="size-4" weight="light" />
                              Connect
                            </MenuItem>
                            <MenuItem
                              onClick={() =>
                                router.push(
                                  `/sandboxes/${sandbox.id}/terminal/`,
                                )
                              }
                            >
                              <TerminalIcon className="size-4" weight="light" />
                              Open Terminal
                            </MenuItem>
                            <MenuItem>
                              <KeyIcon className="size-4" weight="light" />
                              Create SSH Access
                            </MenuItem>
                            <MenuItem>
                              <KeyReturnIcon
                                className="size-4"
                                weight="light"
                              />
                              Remove SSH Access
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem
                              className="text-destructive hover:text-destructive"
                              onClick={() =>
                                setDeleteTarget({
                                  id: sandbox.id,
                                  name: sandbox.name,
                                })
                              }
                            >
                              <TrashIcon className="size-4" weight="light" />
                              Delete
                            </MenuItem>
                          </MenuPopup>
                        </Menu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </StickyHoverTableBody>
            </Table>
          </div>
        </>
      )}

      {connectSandboxId && (
        <ConnectSandboxDialog
          sandboxId={connectSandboxId}
          open={!!connectSandboxId}
          onOpenChange={(v) => {
            if (!v) setConnectSandboxId(null)
          }}
        />
      )}

      {deleteTarget && (
        <DeleteSandboxDialog
          open={!!deleteTarget}
          onOpenChange={(v) => {
            if (!v) setDeleteTarget(null)
          }}
          sandboxName={deleteTarget.name}
          onConfirm={() => {
            posthog.capture(SANDBOX_EVENTS.DELETED, { id: deleteTarget.id })
            return new Promise<void>((resolve, reject) => {
              deleteSandbox.mutate(deleteTarget.id, {
                onSuccess: () => {
                  setDeleteTarget(null)
                  resolve()
                },
                onError: reject,
              })
            })
          }}
        />
      )}

      <DeleteSandboxDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        bulkCount={selected.size}
        onConfirm={() => {
          posthog.capture(SANDBOX_EVENTS.BULK_DELETED, {
            count: selected.size,
          })
          return new Promise<void>((resolve, reject) => {
            bulkDelete.mutate([...selected], {
              onSuccess: () => {
                clearSelection()
                setBulkDeleteOpen(false)
                resolve()
              },
              onError: reject,
            })
          })
        }}
      />
    </div>
  )
}
