"use client"

import { PlusIcon, StackIcon } from "@phosphor-icons/react"
import { Button, Table, TableHead, TableHeader, TableRow } from "@superserve/ui"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { CreateTemplateDialog } from "@/components/templates/create-template-dialog"
import { TemplateTableRow } from "@/components/templates/template-table-row"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useTemplates } from "@/hooks/use-templates"

export default function TemplatesPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search.trim(), 300)

  const {
    data: templates,
    isPending,
    error,
    refetch,
  } = useTemplates(debouncedSearch || undefined)

  const visible = useMemo(() => templates ?? [], [templates])

  const newButton = (
    <Button size="sm" onClick={() => setCreateOpen(true)}>
      <PlusIcon className="size-3.5" weight="light" />
      New template
    </Button>
  )

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Templates">{newButton}</PageHeader>
        <TableSkeleton columns={6} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Templates">{newButton}</PageHeader>
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </div>
    )
  }

  const isEmpty = visible.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Templates">{newButton}</PageHeader>

      {isEmpty && !debouncedSearch ? (
        <EmptyState
          icon={StackIcon}
          title="No templates yet"
          description="Templates are pre-baked VM images your sandboxes boot from. Create one to reuse the same environment across sandboxes."
          actionLabel="Create template"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <>
          <TableToolbar
            id="templates-toolbar"
            searchPlaceholder="Search aliases…"
            searchValue={search}
            onSearchChange={setSearch}
          />

          <div className="flex-1 overflow-y-auto">
            {isEmpty ? (
              <EmptyState
                icon={StackIcon}
                title="No templates match that search"
                description="Try a different alias prefix."
              />
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-[28%]">Alias</TableHead>
                    <TableHead className="w-[14%]">Status</TableHead>
                    <TableHead className="w-[26%]">Resources</TableHead>
                    <TableHead className="w-[12%]">Size</TableHead>
                    <TableHead className="w-[14%]">Built</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <StickyHoverTableBody>
                  {visible.map((t) => (
                    <TemplateTableRow key={t.id} template={t} />
                  ))}
                </StickyHoverTableBody>
              </Table>
            )}
          </div>
        </>
      )}

      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        hideTrigger
      />
    </div>
  )
}
