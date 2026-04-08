"use client"

import { Suspense } from "react"
import { TableSkeleton } from "@/components/table-skeleton"

export default function SandboxesPage() {
  return (
    <Suspense fallback={<TableSkeleton columns={6} tabs={3} />}>
      <SandboxesPageContent />
    </Suspense>
  )
}

import { CubeIcon } from "@phosphor-icons/react"
import {
  Checkbox,
  Table,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { AnimatePresence } from "motion/react"
import { useRouter, useSearchParams } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { ConnectSandboxDialog } from "@/components/sandboxes/connect-sandbox-dialog"
import { CreateSandboxDialog } from "@/components/sandboxes/create-sandbox-dialog"
import { DeleteSandboxDialog } from "@/components/sandboxes/delete-sandbox-dialog"
import { SandboxTableRow } from "@/components/sandboxes/sandbox-table-row"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableToolbar } from "@/components/table-toolbar"
import {
  useBulkDeleteSandboxes,
  useDeleteSandbox,
  usePauseSandbox,
  useResumeSandbox,
  useSandboxes,
} from "@/hooks/use-sandboxes"
import { useSelection } from "@/hooks/use-selection"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"

const STATUS_TABS = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Idle", value: "idle" },
]

function SandboxesPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const posthog = usePostHog()
  const statusFilter = searchParams.get("status") ?? "all"
  const search = searchParams.get("q") ?? ""

  const setStatusFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === "all") params.delete("status")
    else params.set("status", value)
    router.replace(`?${params.toString()}`)
  }

  const setSearch = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (!value) params.delete("q")
    else params.set("q", value)
    router.replace(`?${params.toString()}`)
  }
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
          description="Create a sandbox to run code in an isolated cloud environment."
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
                <AnimatePresence initial={false}>
                  {filtered.map((sandbox) => (
                    <SandboxTableRow
                      key={sandbox.id}
                      sandbox={sandbox}
                      selected={selected.has(sandbox.id)}
                      onToggle={() => toggleOne(sandbox.id)}
                      onConnect={() => setConnectSandboxId(sandbox.id)}
                      onDelete={() =>
                        setDeleteTarget({
                          id: sandbox.id,
                          name: sandbox.name,
                        })
                      }
                      onPause={() => pauseMutation.mutate(sandbox.id)}
                      onResume={() => resumeMutation.mutate(sandbox.id)}
                    />
                  ))}
                </AnimatePresence>
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
