"use client"

import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  CheckIcon,
  CopyIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { Button, buttonVariants, cn, useToast } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"

import { ErrorState } from "@/components/error-state"
import { AdminLinkPanel } from "@/components/qm/admin-link-panel"
import { DeleteTenantDialog } from "@/components/qm/delete-tenant-dialog"
import { ProvisioningSteps } from "@/components/qm/provisioning-steps"
import { TenantStatusBadge } from "@/components/qm/tenant-status-badge"
import { useDashboardTeamContext } from "@/components/query-provider"
import {
  useDeleteQmTenant,
  useQmTenant,
  useRetryQmTenant,
} from "@/hooks/use-qm-tenants"
import { ApiError } from "@/lib/api/client"
import { qmKeys } from "@/lib/api/query-keys"
import type { QmTenant } from "@/lib/api/types"
import { formatDate, formatTime } from "@/lib/format"
import { QM_EVENTS } from "@/lib/posthog/events"
import {
  formatElapsed,
  lastActivityAt,
  latestRun,
  runStaleAfterMs,
  type TenantRun,
} from "@/lib/qm/events"
import {
  HARNESS_LABEL,
  PROVIDER_LABEL,
  QM_STATUS_LABEL,
  SIGN_IN_LABEL,
} from "@/lib/qm/options"
import { qmRetentionDays } from "@/lib/qm/retention"
import { tenantUrl } from "@/lib/qm/slug"

const GENERIC_FAILURE: Record<"provision" | "deprovision", string> = {
  provision:
    "Provisioning stopped before the stack was ready. Retry to continue from where it left off, or delete the stack.",
  deprovision:
    "Teardown stopped before everything was removed. Retry to continue the teardown.",
}

export default function QmTenantDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const posthog = usePostHog()
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const tenantId = params.id

  // Viewing another team is read-only at the proxy, so no mutation is
  // offered — an operator should not be invited into a guaranteed 403.
  const readOnly = useDashboardTeamContext() !== null
  const { data, isPending, error, refetch } = useQmTenant(tenantId)
  const transitionalStatus =
    data?.tenant.status === "provisioning" ||
    data?.tenant.status === "deprovisioning"
  const now = useClock(transitionalStatus ? 30_000 : null)
  const deleteMutation = useDeleteQmTenant()
  const retryMutation = useRetryQmTenant()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const status = data?.tenant.status
  const gone =
    status === "deleted" || (error instanceof ApiError && error.status === 404)

  // Once the stack is gone there is nothing to show here; go back to the
  // list, which will either be empty or show the remaining stacks. The
  // cached list may still carry this tenant (it is fresh for 30s), and the
  // list page would send a sole tenant straight back here — so drop it
  // from every cached list first, then let the list refetch.
  useEffect(() => {
    if (!gone) return
    queryClient.setQueriesData<QmTenant[]>(
      { queryKey: qmKeys.lists() },
      (old) => old?.filter((t) => t.id !== tenantId),
    )
    queryClient.invalidateQueries({ queryKey: qmKeys.lists() })
    router.replace("/qm")
  }, [gone, queryClient, router, tenantId])

  if (isPending || gone) return <DetailSkeleton />

  if (error || !data) {
    return (
      <div className="flex h-full flex-col">
        <Breadcrumb />
        <ErrorState
          message={error?.message ?? "Failed to load this stack."}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  const { tenant, events } = data
  const transitional =
    tenant.status === "provisioning" || tenant.status === "deprovisioning"
  const run = latestRun(events)
  const retentionDays = qmRetentionDays()
  // A failed tenant keeps the mode of the run that failed; retrying resumes
  // that same plan, so the UI must say "teardown" when that is what stalled.
  const teardown =
    tenant.status === "deprovisioning" ||
    (tenant.status === "failed" && run.mode === "deprovision")
  // A run that dies without a terminal event stays "in flight" forever from
  // the poll's point of view; qm-api only reclaims it when Retry or Delete
  // is called. Offer both once the run has gone quiet for as long as the
  // API's own threshold.
  const quietMs = now - lastActivityAt(events, tenant.updatedAt)
  const stalled = transitional && quietMs >= runStaleAfterMs()
  const canRetry =
    !readOnly && ((tenant.status === "failed" && run.canRetry) || stalled)
  const canDelete =
    !readOnly &&
    (tenant.status === "ready" || tenant.status === "failed" || stalled)

  const handleRetry = () => {
    posthog.capture(QM_EVENTS.STACK_RETRIED, {
      tenant_id: tenant.id,
      mode: teardown ? "deprovision" : "provision",
    })
    retryMutation.mutate(tenant.id, {
      onSuccess: () =>
        addToast(
          teardown ? "Retrying teardown" : "Retrying provisioning",
          "success",
        ),
    })
  }

  const handleDelete = () =>
    new Promise<void>((resolve, reject) => {
      posthog.capture(QM_EVENTS.STACK_DELETED, { tenant_id: tenant.id })
      deleteMutation.mutate(tenant.id, {
        onSuccess: () => {
          addToast("Deleting the stack", "success")
          resolve()
        },
        onError: reject,
      })
    })

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb slug={tenant.slug} />

      <div className="flex-1 overflow-y-auto">
        <StatusHero
          tenant={tenant}
          onRetry={canRetry ? handleRetry : undefined}
          retrying={retryMutation.isPending}
          onDelete={canDelete ? () => setDeleteOpen(true) : undefined}
          readOnly={readOnly}
        />

        {stalled && (
          <StalledPanel
            teardown={teardown}
            quietMs={quietMs}
            onRetry={canRetry ? handleRetry : undefined}
            retrying={retryMutation.isPending}
            onDelete={canDelete ? () => setDeleteOpen(true) : undefined}
          />
        )}

        {tenant.status === "failed" && (
          <FailurePanel
            run={run}
            teardown={teardown}
            onRetry={canRetry ? handleRetry : undefined}
            retrying={retryMutation.isPending}
            onDelete={canDelete ? () => setDeleteOpen(true) : undefined}
          />
        )}

        {(transitional || tenant.status === "failed") && (
          <section className="border-b border-border">
            <div className="flex h-10 items-center justify-between px-4">
              <h2 className="text-sm font-semibold text-foreground">
                {teardown ? "Teardown" : "Provisioning"}
              </h2>
              {teardown && retentionDays && (
                <span className="font-mono text-xs text-muted uppercase">
                  Data kept {retentionDays} days
                </span>
              )}
            </div>
            <ProvisioningSteps
              run={run}
              live={transitional}
              emptyMessage={
                transitional
                  ? "Waiting for the first step to start…"
                  : "No steps ran."
              }
            />
          </section>
        )}

        {tenant.status === "ready" && !readOnly && (
          <AdminLinkPanel tenantId={tenant.id} adminEmail={tenant.adminEmail} />
        )}

        <InfoGrid tenant={tenant} />

        {canDelete && (
          <DangerZone
            onDelete={() => setDeleteOpen(true)}
            retentionDays={retentionDays}
          />
        )}
      </div>

      <DeleteTenantDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        slug={tenant.slug}
        onConfirm={handleDelete}
      />
    </div>
  )
}

// --- Pieces ----------------------------------------------------------------

/** Re-renders every `intervalMs` (null pauses); returns the current time. */
function useClock(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (intervalMs === null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function StalledPanel({
  teardown,
  quietMs,
  onRetry,
  retrying,
  onDelete,
}: {
  teardown: boolean
  quietMs: number
  onRetry?: () => void
  retrying: boolean
  onDelete?: () => void
}) {
  return (
    <section
      role="alert"
      className="border-b border-border bg-warning/[0.04] px-4 py-4"
    >
      <p className="text-sm text-foreground">
        {teardown ? "Teardown" : "Provisioning"} hasn&apos;t reported progress
        for {formatElapsed(quietMs)}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        The run may have been lost. Retry re-queues it from where it stopped;
        delete tears the stack down instead.
      </p>
      {(onRetry || onDelete) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onRetry && (
            <Button size="sm" onClick={onRetry} disabled={retrying}>
              <ArrowClockwiseIcon className="size-3.5" weight="light" />
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          )}
          {onDelete && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <TrashIcon className="size-3.5" weight="light" />
              Delete
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

function Breadcrumb({ slug }: { slug?: string }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4 font-mono text-xs uppercase">
      <Link
        href="/qm"
        className="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" weight="light" />
        QM
      </Link>
      {slug && (
        <>
          <span className="text-muted">/</span>
          <span className="truncate text-foreground/80 normal-case">
            {slug}
          </span>
        </>
      )}
    </div>
  )
}

const HERO_STYLE: Record<
  QmTenant["status"],
  { bg: string; dot: string; pulse: boolean }
> = {
  provisioning: { bg: "bg-warning/[0.04]", dot: "bg-warning", pulse: true },
  ready: { bg: "bg-brand/[0.05]", dot: "bg-brand", pulse: false },
  failed: { bg: "bg-destructive/[0.04]", dot: "bg-destructive", pulse: false },
  deprovisioning: { bg: "bg-warning/[0.04]", dot: "bg-warning", pulse: true },
  deleted: { bg: "bg-foreground/[0.02]", dot: "bg-muted", pulse: false },
}

function StatusHero({
  tenant,
  onRetry,
  retrying,
  onDelete,
  readOnly,
}: {
  tenant: QmTenant
  onRetry?: () => void
  retrying: boolean
  onDelete?: () => void
  readOnly: boolean
}) {
  const style = HERO_STYLE[tenant.status]
  const url = tenant.publicUrl ?? tenantUrl(tenant.slug)
  const created = formatTime(new Date(tenant.createdAt))
  const [copied, setCopied] = useState(false)

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable; the URL is visible to select by hand.
    }
  }

  return (
    <section className={cn("border-b border-border px-4 py-6", style.bg)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "relative mt-2 inline-flex size-2 shrink-0",
              style.dot,
            )}
          >
            {style.pulse && (
              <span
                className={cn(
                  "absolute inline-flex size-full animate-ping rounded-full opacity-75",
                  style.dot,
                )}
              />
            )}
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-mono text-xl font-medium text-foreground">
              {tenant.slug}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted uppercase">
              <span className="text-foreground/80">
                {QM_STATUS_LABEL[tenant.status]}
              </span>
              <span>·</span>
              <span className="normal-case">{tenant.orgName}</span>
              <span>·</span>
              <span title={created.absolute}>Created {created.relative}</span>
            </div>
            <div className="mt-3 flex min-w-0 items-center gap-1.5">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs text-foreground/80 transition-colors hover:text-brand"
              >
                <span className="truncate">{url}</span>
                <ArrowSquareOutIcon
                  className="size-3.5 shrink-0"
                  weight="light"
                />
              </a>
              <button
                type="button"
                onClick={copyUrl}
                aria-label={copied ? "Copied" : "Copy stack URL"}
                className="inline-flex shrink-0 text-muted transition-colors hover:text-foreground"
              >
                {copied ? (
                  <CheckIcon className="size-3.5 text-brand" weight="bold" />
                ) : (
                  <CopyIcon className="size-3.5" weight="light" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {readOnly && (
            <span className="font-mono text-xs text-muted uppercase">
              Read-only
            </span>
          )}
          {onRetry && (
            <Button size="sm" onClick={onRetry} disabled={retrying}>
              <ArrowClockwiseIcon className="size-3.5" weight="light" />
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          )}
          {tenant.status === "ready" && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ size: "sm" })}
            >
              <ArrowSquareOutIcon className="size-3.5" weight="light" />
              Open
            </a>
          )}
          {onDelete && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <TrashIcon className="size-3.5" weight="light" />
              Delete
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

function FailurePanel({
  run,
  teardown,
  onRetry,
  retrying,
  onDelete,
}: {
  run: TenantRun
  teardown: boolean
  onRetry?: () => void
  retrying: boolean
  onDelete?: () => void
}) {
  return (
    <section
      role="alert"
      className="border-b border-border bg-destructive/[0.04] px-4 py-4"
    >
      <p className="text-sm text-foreground">
        {teardown ? "Teardown failed" : "Provisioning failed"}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        {run.failureMessage ??
          GENERIC_FAILURE[teardown ? "deprovision" : "provision"]}
      </p>
      {(onRetry || onDelete) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onRetry && (
            <Button size="sm" onClick={onRetry} disabled={retrying}>
              <ArrowClockwiseIcon className="size-3.5" weight="light" />
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          )}
          {onDelete && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <TrashIcon className="size-3.5" weight="light" />
              Delete
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

function InfoGrid({ tenant }: { tenant: QmTenant }) {
  const cells: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    { label: "Status", value: <TenantStatusBadge status={tenant.status} /> },
    { label: "QM version", value: tenant.imageTag ?? "—", mono: true },
    { label: "Admin email", value: tenant.adminEmail },
    { label: "Sign-in", value: SIGN_IN_LABEL[tenant.signIn] },
    { label: "Provider", value: PROVIDER_LABEL[tenant.modelProvider] },
    { label: "Harness", value: HARNESS_LABEL[tenant.harness], mono: true },
    { label: "Created", value: formatDate(new Date(tenant.createdAt)) },
    { label: "Updated", value: formatDate(new Date(tenant.updatedAt)) },
  ]
  return (
    <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={cn(
            "border-b border-border px-4 py-4",
            i % 2 === 0 && "border-r",
            "sm:border-r sm:[&:nth-child(4n)]:border-r-0",
            i >= cells.length - 2 && "border-b-0",
            i < cells.length - 4 && "sm:border-b",
            i >= cells.length - 4 && "sm:border-b-0",
          )}
        >
          <p className="text-xs text-muted">{cell.label}</p>
          <div
            className={cn(
              "mt-2 text-sm break-words text-foreground/80",
              cell.mono && "font-mono",
            )}
          >
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  )
}

function DangerZone({
  onDelete,
  retentionDays,
}: {
  onDelete: () => void
  retentionDays: number | null
}) {
  return (
    <section className="px-4 py-6">
      <div className="border border-dashed border-destructive/40">
        <div className="flex h-10 items-center border-b border-dashed border-destructive/40 px-4 font-mono text-xs text-destructive uppercase">
          Danger zone
        </div>
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-foreground">Delete this stack</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Takes the stack offline immediately.{" "}
              {retentionDays
                ? `Data is kept for ${retentionDays} days, then permanently erased.`
                : "Its data is deleted with it and the stack cannot be restored."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <TrashIcon className="size-3.5" weight="light" />
            Delete stack
          </Button>
        </div>
      </div>
    </section>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center border-b border-border px-4">
        <div className="h-3 w-24 animate-pulse bg-muted/20" />
      </div>
      <div className="border-b border-border bg-foreground/[0.02] px-4 py-6">
        <div className="flex items-start gap-3">
          <div className="mt-2 size-2 shrink-0 animate-pulse bg-muted/40" />
          <div>
            <div className="h-6 w-40 animate-pulse bg-muted/30" />
            <div className="mt-2 h-3 w-56 animate-pulse bg-muted/20" />
            <div className="mt-3 h-3 w-64 animate-pulse bg-muted/20" />
          </div>
        </div>
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border px-4 py-3"
        >
          <div className="h-3 w-5 animate-pulse bg-muted/20" />
          <div className="size-4 animate-pulse bg-muted/20" />
          <div className="h-3 w-40 animate-pulse bg-muted/20" />
        </div>
      ))}
    </div>
  )
}
