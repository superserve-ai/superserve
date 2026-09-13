"use client"

import { ArrowSquareOutIcon, RobotIcon } from "@phosphor-icons/react"
import {
  Button,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { AnimatedTableRow } from "@/components/animated-table-row"
import { CornerBrackets } from "@/components/corner-brackets"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { TenantStatusBadge } from "@/components/qm/tenant-status-badge"
import { useDashboardTeamContext } from "@/components/query-provider"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { useQmTenants } from "@/hooks/use-qm-tenants"
import type { QmTenant } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { tenantUrl } from "@/lib/qm/slug"

/**
 * Entry point for QM Cloud. qm-api allows one live stack per team, so the
 * common case is exactly one tenant, which sends you straight to its detail
 * page. The table exists for the defensive case of several live tenants
 * (e.g. the limit is lifted later); creation is only offered when there is
 * none, since it cannot succeed otherwise.
 */
export default function QmPage() {
  const router = useRouter()
  // Viewing another team is read-only, so creation is never offered there.
  const readOnly = useDashboardTeamContext() !== null
  const { data, isPending, error, refetch } = useQmTenants()

  // Deleted tenants may linger in the list for the retention window; they
  // are not something you can open, so they don't count.
  const tenants = useMemo(
    () => (data ?? []).filter((t) => t.status !== "deleted"),
    [data],
  )
  const only = tenants.length === 1 ? tenants[0] : null

  useEffect(() => {
    if (only) router.replace(`/qm/${only.id}`)
  }, [only, router])

  if (isPending || only) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="QM" />
        <TableSkeleton columns={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="QM" />
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </div>
    )
  }

  if (tenants.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="QM" />
        <QmEmptyState readOnly={readOnly} />
      </div>
    )
  }

  return <QmTenantTable tenants={tenants} />
}

function QmEmptyState({ readOnly }: { readOnly: boolean }) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-4 py-16">
      <div className="relative flex w-full max-w-sm flex-col items-center px-8 py-10 text-center sm:px-10">
        <CornerBrackets size="lg" />
        <RobotIcon className="size-10 text-foreground/60" weight="light" />
        <p className="mt-4 text-sm font-medium text-foreground">
          No QM stack yet
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          A QM stack is your team&apos;s own hosted copy of QM, the open-source
          agent harness: an isolated deployment at{" "}
          <span className="font-mono text-foreground/80">
            your-org.qm.superserve.ai
          </span>{" "}
          with its own database, sign-in, and model provider. Superserve runs
          and upgrades it; your team just uses it.
        </p>
        {readOnly ? (
          <p className="mt-5 font-mono text-xs text-muted uppercase">
            Read-only while viewing another team
          </p>
        ) : (
          <div className="mt-5">
            <Button size="sm" render={<Link href="/qm/new" />}>
              Create your QM stack
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function QmTenantTable({ tenants }: { tenants: QmTenant[] }) {
  const router = useRouter()
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter(
      (t) =>
        t.slug.toLowerCase().includes(q) ||
        t.orgName.toLowerCase().includes(q) ||
        t.adminEmail.toLowerCase().includes(q),
    )
  }, [tenants, search])

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="QM" />
      <TableToolbar
        id="qm-toolbar"
        searchPlaceholder="Search stacks..."
        searchValue={search}
        onSearchChange={setSearch}
      />

      <div className="flex-1 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
            <TableRow>
              <TableHead>Stack</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>QM version</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <StickyHoverTableBody>
            {filtered.map((tenant) => {
              const url = tenant.publicUrl ?? tenantUrl(tenant.slug)
              return (
                <AnimatedTableRow
                  key={tenant.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/qm/${tenant.id}`)}
                >
                  <TableCell>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-mono text-foreground/80">
                        {tenant.slug}
                      </span>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 font-mono text-xs text-muted transition-colors hover:text-brand"
                      >
                        <span className="truncate">
                          {url.replace(/^https?:\/\//, "")}
                        </span>
                        <ArrowSquareOutIcon
                          className="size-3 shrink-0"
                          weight="light"
                        />
                      </a>
                    </div>
                  </TableCell>
                  <TableCell>
                    <TenantStatusBadge status={tenant.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted">
                    {tenant.imageTag ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted">
                    {tenant.adminEmail}
                  </TableCell>
                  <TableCell className="text-muted tabular-nums">
                    {formatDate(new Date(tenant.createdAt))}
                  </TableCell>
                </AnimatedTableRow>
              )
            })}
          </StickyHoverTableBody>
        </Table>
        {filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted">
            No stacks match &ldquo;{search}&rdquo;.
          </p>
        )}
      </div>
    </div>
  )
}
