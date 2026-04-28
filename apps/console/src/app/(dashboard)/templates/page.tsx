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
import { useTemplates } from "@/hooks/use-templates"
import { isSystemTemplate } from "@/lib/templates/is-system-template"

type Tab = "all" | "team" | "system"

export default function TemplatesPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const [tab, setTab] = useState<Tab>("all")
  const [search, setSearch] = useState("")

  const { data: templates, isPending, error, refetch } = useTemplates()

  const counts = useMemo(() => {
    if (!templates) return { all: 0, team: 0, system: 0 }
    let team = 0
    let system = 0
    for (const t of templates) {
      if (isSystemTemplate(t)) system++
      else team++
    }
    return { all: templates.length, team, system }
  }, [templates])

  const filtered = useMemo(() => {
    if (!templates) return []
    const byTab =
      tab === "all"
        ? templates
        : tab === "team"
          ? templates.filter((t) => !isSystemTemplate(t))
          : templates.filter((t) => isSystemTemplate(t))

    const q = search.trim().toLowerCase()
    if (!q) return byTab
    return byTab.filter((t) => t.alias.toLowerCase().includes(q))
  }, [templates, tab, search])

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
        <TableSkeleton columns={6} tabs={3} />
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

  const totalEmpty = (templates?.length ?? 0) === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Templates">{newButton}</PageHeader>

      {totalEmpty ? (
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
            tabs={[
              { value: "all", label: "All", count: counts.all },
              { value: "team", label: "Team", count: counts.team },
              { value: "system", label: "System", count: counts.system },
            ]}
            activeTab={tab}
            onTabChange={(v) => setTab(v as Tab)}
            searchPlaceholder="Search aliases…"
            searchValue={search}
            onSearchChange={setSearch}
          />

          <div className="flex flex-1 flex-col overflow-y-auto">
            {filtered.length === 0 ? (
              <EmptyState
                icon={StackIcon}
                title={
                  search
                    ? "No templates match that search"
                    : tab === "team"
                      ? "No team templates yet"
                      : "No system templates available"
                }
                description={
                  search
                    ? "Try a different alias prefix."
                    : tab === "team"
                      ? "Create one to get started."
                      : "System templates are curated by Superserve."
                }
                actionLabel={
                  !search && tab === "team" ? "Create template" : undefined
                }
                onAction={
                  !search && tab === "team"
                    ? () => setCreateOpen(true)
                    : undefined
                }
              />
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-[30%]">Name</TableHead>
                    <TableHead className="w-[12%]">Status</TableHead>
                    <TableHead className="w-[26%]">Resources</TableHead>
                    <TableHead className="w-[14%]">Created</TableHead>
                    <TableHead className="w-[14%]">Updated</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <StickyHoverTableBody>
                  {filtered.map((t) => (
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
