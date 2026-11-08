"use client"

import { CaretLeftIcon } from "@phosphor-icons/react"
import {
  Checkbox,
  Table,
  TableHead,
  TableHeader,
  TableRow,
  ToastProvider,
  TooltipProvider,
} from "@superserve/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { PageHeader } from "@/components/page-header"
import { SortableTableHead } from "@/components/sortable-table-head"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"

import {
  CreateSandboxDialog,
  MetadataSection,
  NetworkSection,
  SandboxTableRow,
} from "../../components"
import { SANDBOXES } from "../../fixtures"

function SandboxList() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [log, setLog] = useState("")
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const note = (action: string, name: string) => setLog(`${action}: ${name}`)

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Sandboxes">
        <CreateSandboxDialog />
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
            <TableRow>
              <TableHead className="w-10 pr-0">
                <Checkbox
                  checked={selected.size === SANDBOXES.length}
                  indeterminate={
                    selected.size > 0 && selected.size < SANDBOXES.length
                  }
                  onCheckedChange={() =>
                    setSelected(
                      selected.size === SANDBOXES.length
                        ? new Set()
                        : new Set(SANDBOXES.map((s) => s.id)),
                    )
                  }
                  aria-label="Select all sandboxes"
                />
              </TableHead>
              <SortableTableHead
                column="name"
                label="Name"
                activeSort="created_at"
                order="desc"
                onSort={() => {}}
                className="w-[30%]"
              />
              <SortableTableHead
                column="status"
                label="Status"
                activeSort="created_at"
                order="desc"
                onSort={() => {}}
                className="w-[15%]"
              />
              <TableHead className="w-[15%]">Resources</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <StickyHoverTableBody>
            {SANDBOXES.map((sandbox) => (
              <SandboxTableRow
                key={sandbox.id}
                sandbox={sandbox}
                selected={selected.has(sandbox.id)}
                onToggle={() => toggle(sandbox.id)}
                onConnect={() => note("Connect", sandbox.name)}
                onDelete={() => note("Delete", sandbox.name)}
                onPause={() => note("Pause", sandbox.name)}
                onResume={() => note("Resume", sandbox.name)}
                onOpenTerminal={() => note("Terminal", sandbox.name)}
                onTakeSnapshot={() => note("Snapshot", sandbox.name)}
              />
            ))}
          </StickyHoverTableBody>
        </Table>
        <p className="px-4 py-3 text-xs text-muted" data-testid="action-log">
          {log && `Last row action (simulated): ${log}`}
        </p>
      </div>
    </div>
  )
}

function SandboxDetail({ id }: { id: string }) {
  const sandbox = SANDBOXES.find((s) => s.id === id)
  if (!sandbox) return <p className="p-4 text-sm">Unknown fixture sandbox</p>
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link
          href="/sandboxes/"
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
        >
          <CaretLeftIcon className="size-3.5" weight="light" />
          Sandboxes
        </Link>
        <h1
          className="font-mono text-sm font-semibold"
          data-testid="detail-title"
        >
          {sandbox.name}
        </h1>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 border-b border-border">
          <div className="border-r border-border">
            <NetworkSection sandbox={sandbox} />
          </div>
          <MetadataSection sandbox={sandbox} />
        </div>
      </div>
    </div>
  )
}

export default function Page() {
  const path = usePathname().replace(/\/$/, "")
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  )
  const detail = path.match(/^\/sandboxes\/([^/]+)$/)

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TooltipProvider>
          <div className="flex h-dvh flex-col bg-background text-foreground">
            <aside className="shrink-0 border-b border-border px-4 py-2 text-xs text-muted">
              Local UI fixture · production components · stubbed data, no
              network
            </aside>
            <main className="flex min-h-0 flex-1 flex-col">
              {path === "/sandboxes" || path === "" ? (
                <SandboxList />
              ) : detail ? (
                <SandboxDetail id={detail[1]} />
              ) : (
                <p className="p-4 text-sm">Unknown fixture route</p>
              )}
            </main>
          </div>
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
