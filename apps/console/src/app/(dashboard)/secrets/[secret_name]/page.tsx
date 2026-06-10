"use client"

import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { Badge, Button } from "@superserve/ui"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"

import { ErrorState } from "@/components/error-state"
import { AuditLogTable } from "@/components/secrets/audit-log-table"
import { AuthShapeVisualization } from "@/components/secrets/auth-shape-visualization"
import { AUTH_TYPE_LABEL } from "@/components/secrets/auth-type-label"
import { DeleteSecretDialog } from "@/components/secrets/delete-secret-dialog"
import { RotateSecretDialog } from "@/components/secrets/rotate-secret-dialog"
import { SecretDetailSkeleton } from "@/components/secrets/secret-detail-skeleton"
import { SecretInfoGrid } from "@/components/secrets/secret-info-grid"
import { SecretSandboxesPanel } from "@/components/secrets/secret-sandboxes-panel"
import { useProviders } from "@/hooks/use-providers"
import {
  useSecret,
  useSecretAudit,
  useSecretSandboxes,
} from "@/hooks/use-secrets"
import type { AuditStatusFilter } from "@/lib/api/types"

export default function SecretDetailPage() {
  const params = useParams<{ secret_name: string }>()
  const router = useRouter()
  const [rotateOpen, setRotateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [auditFilter, setAuditFilter] = useState<AuditStatusFilter>("")

  const { data, isPending, error, refetch } = useSecret(params?.secret_name)
  const { data: providers } = useProviders()
  const { data: bindings, isPending: bindingsPending } = useSecretSandboxes(
    params?.secret_name,
  )
  const audit = useSecretAudit(params?.secret_name, { status: auditFilter })

  if (isPending) return <SecretDetailSkeleton />

  if (error || !data) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-border px-6">
          <Link
            href="/secrets/"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
            Secrets
          </Link>
        </div>
        <ErrorState
          message={error?.message ?? "Secret not found"}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  const providerDisplay = data.provider_shortcut
    ? providers?.find((p) => p.name === data.provider_shortcut)?.display
    : undefined

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/secrets/"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
            Secrets
          </Link>
          <span className="text-muted">/</span>
          <h1 className="font-mono text-sm font-medium text-foreground">
            {data.name}
          </h1>
          <Badge variant="muted">{AUTH_TYPE_LABEL[data.auth_type]}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRotateOpen(true)}
          >
            <ArrowsClockwiseIcon className="size-3.5" weight="light" />
            Rotate value
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <TrashIcon className="size-3.5" weight="light" />
            Delete
          </Button>
        </div>
      </div>

      <RotateSecretDialog
        secretName={data.name}
        open={rotateOpen}
        onOpenChange={setRotateOpen}
      />
      <DeleteSecretDialog
        secretName={data.name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => router.push("/secrets/")}
      />

      <div className="flex-1 overflow-y-auto">
        <SecretInfoGrid secret={data} providerDisplay={providerDisplay} />

        <div className="flex h-10 items-center border-b border-border px-4">
          <p className="text-xs font-medium text-foreground/80">
            Allowed hosts
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 border-b border-border p-4">
          {data.hosts.map((host) => (
            <Badge key={host} variant="muted" className="font-mono lowercase">
              {host}
            </Badge>
          ))}
        </div>

        <div className="flex h-10 items-center border-b border-border px-4">
          <p className="text-xs font-medium text-foreground/80">
            Authentication
          </p>
        </div>
        <div className="border-b border-border p-4">
          <AuthShapeVisualization
            authType={data.auth_type}
            authConfig={data.auth_config}
          />
        </div>

        <SecretSandboxesPanel bindings={bindings} isPending={bindingsPending} />

        <AuditLogTable
          title="Activity"
          events={audit.data}
          isPending={audit.isPending}
          statusFilter={auditFilter}
          onStatusFilterChange={setAuditFilter}
          showSandboxColumn
          emptyDescription="Every request authenticated with this secret appears here."
        />
      </div>
    </div>
  )
}
