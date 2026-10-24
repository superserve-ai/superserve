"use client"

import {
  Alert,
  Badge,
  Button,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@superserve/ui"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  catalogDrift,
  draftFromVersion,
  mergeCatalogs,
  needsSync,
  outOfStep,
  planSet,
  pricingVersions,
  type BillingCatalog,
  type PlanDraft,
  type PlanVersion,
  type RegionState,
} from "@/lib/admin/billing-catalog"
import {
  deleteDraftAction,
  publishVersionAction,
  retireVersionAction,
  syncVersionAction,
  type CatalogResult,
  type FanOutResult,
} from "@/lib/admin/billing-catalog-actions"
import { formatUsdCents } from "@/lib/billing/plans"

import { PlanEditor } from "./plan-editor"
import { PRICING_LABEL, PricingActivation } from "./pricing-activation"
import { ReasonDialog } from "./reason-dialog"

const STATE_BADGE = {
  draft: "warning",
  published: "success",
  retired: "muted",
  missing: "destructive",
} as const

export const EMPTY_DRAFT: PlanDraft = {
  pricing_version: "legacy",
  family: "",
  kind: "subscription",
  public: false,
  display_name: "",
  price_label: "",
  tagline: "",
  features: [],
  sort_order: 0,
  display_only: false,
  self_serve: false,
  monthly_fee_cents: null,
  annual_fee_cents: null,
  credit_schedule: [],
  matching: null,
  allowance: null,
  limits: {
    max_concurrent: null,
    max_vcpu: null,
    max_memory_mib: null,
    max_disk_mib: null,
    max_templates: null,
  },
}

export type Confirmation = {
  title: string
  description: string
  action: (reason: string) => Promise<FanOutResult>
  done: string
  onDone?: () => void
}

type Editing = { draft: PlanDraft; id?: string; key: number }

function fees(version: PlanVersion) {
  if (version.price_label) return version.price_label
  if (version.display_only) return "Custom"
  if (version.monthly_fee_cents === null && version.annual_fee_cents === null)
    return "No fee"
  return [
    version.monthly_fee_cents !== null
      ? `${formatUsdCents(version.monthly_fee_cents)} / mo`
      : null,
    version.annual_fee_cents !== null
      ? `${formatUsdCents(version.annual_fee_cents)} / yr`
      : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

function allowanceText(allowance: NonNullable<PlanVersion["allowance"]>) {
  const amount = allowance.compute
    ? `${allowance.compute.seconds / 3600}h of ${allowance.compute.vcpu} vCPU + ${allowance.compute.memory_gib} GiB`
    : `${formatUsdCents(allowance.amount_cents)} of usage`
  const period = allowance.period === "month" ? "a month" : "every 24 hours"
  const then = allowance.on_exhausted === "pause" ? "pause" : "pay as you go"
  return `${amount} ${period}, then ${then}`
}

function credits(version: PlanVersion) {
  return [
    version.preview.summary,
    version.allowance ? allowanceText(version.allowance) : null,
    version.matching
      ? `${version.matching.matching_bps / 100}% match up to ${formatUsdCents(version.matching.cap_cents)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

function checkoutLabel(version: PlanVersion) {
  const kind = version.display_only
    ? "Display only"
    : !version.self_serve
      ? "Staff assigned"
      : "Self-serve"
  return version.public ? kind : `${kind} · not on public cards`
}

export function failedRegions(result: FanOutResult): string | null {
  const entries = Object.entries(result.errors)
  if (!entries.length) return null
  return entries.map(([region, error]) => `${region}: ${error}`).join("; ")
}

function RegionStates({
  states,
  regions,
}: {
  states: Record<string, RegionState>
  regions: string[]
}) {
  return (
    <span className="flex flex-wrap gap-1">
      {regions.map((region) => (
        <Badge key={region} variant={STATE_BADGE[states[region]!]}>
          {region}: {states[region]}
        </Badge>
      ))}
    </span>
  )
}

export function PlansCatalog({
  catalogs,
  canWrite,
  previewRegion,
}: {
  catalogs: Record<string, CatalogResult<BillingCatalog>>
  canWrite: boolean
  previewRegion: string
}) {
  const router = useRouter()
  const { addToast } = useToast()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [confirm, setConfirm] = useState<Confirmation | null>(null)
  const regions = Object.keys(catalogs)
  const unavailable = Object.entries(catalogs).flatMap(([region, result]) =>
    result.ok ? [] : [`${region}: ${result.error}`],
  )
  const loaded = Object.fromEntries(
    Object.entries(catalogs).flatMap(([r, c]) => (c.ok ? [[r, c.value]] : [])),
  )
  const merged = unavailable.length === 0 ? mergeCatalogs(loaded) : null
  const drift = merged && regions.length > 1 ? catalogDrift(loaded) : []
  const sets = merged ? [...new Set(merged.map((m) => planSet(m.version)))] : []
  const locked = pending || editing !== null

  const openEditor = (draft: PlanDraft, id?: string) =>
    setEditing((current) => ({ draft, id, key: (current?.key ?? 0) + 1 }))

  const report = (result: FanOutResult, done: string, onDone?: () => void) => {
    const failed = failedRegions(result)
    if (failed) {
      addToast(
        `Not applied everywhere (${failed}). Repeat the change, or use Retry sync where it is offered.`,
        "error",
      )
    } else {
      addToast(done, "success")
      onDone?.()
    }
    router.refresh()
  }

  const run = ({ action, done, onDone }: Confirmation, reason: string) =>
    startTransition(async () => report(await action(reason), done, onDone))

  const requestSync = (
    id: string,
    label: string,
    action: (id: string, reason: string) => Promise<FanOutResult>,
  ) =>
    setConfirm({
      title: `Sync ${label} to every region?`,
      description:
        "Regions that are behind are brought to the furthest state this version reached there. Safe to repeat.",
      action: (reason) => action(id, reason),
      done: `${label} is in sync`,
    })

  return (
    <div className="flex flex-col">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-dashed border-border px-4 py-2">
        <h2 className="font-mono text-xs text-muted uppercase">
          Plans & pricing · applies to {regions.join(", ")}
        </h2>
        {canWrite && merged ? (
          <Button
            size="sm"
            variant="outline"
            disabled={locked}
            onClick={() => openEditor(EMPTY_DRAFT)}
          >
            New plan
          </Button>
        ) : null}
      </div>
      <div className="space-y-8 p-4">
        {unavailable.length ? (
          <Alert variant="destructive" title="Catalog unavailable">
            Every region must be reachable before the catalog can be shown or
            changed. {unavailable.join("; ")}
          </Alert>
        ) : null}
        {drift.length ? (
          <Alert variant="warning" title="Regions differ">
            Published terms differ between regions for: {drift.join(", ")}. Use
            Retry sync on the affected versions.
          </Alert>
        ) : null}
        {editing && merged ? (
          <PlanEditor
            key={editing.key}
            previewRegion={previewRegion}
            initial={editing.draft}
            versionId={editing.id}
            busy={pending}
            onCancel={() => setEditing(null)}
            onSaved={(result) =>
              report(result, "Draft saved", () => setEditing(null))
            }
          />
        ) : null}
        {merged ? (
          <>
            <PricingActivation
              live={pricingVersions(loaded)}
              canWrite={canWrite}
              locked={locked}
              confirm={setConfirm}
            />
            {sets.map((set) => (
              <section
                key={set}
                aria-label={`${set} versions`}
                className="space-y-3"
              >
                <h3 className="font-mono text-xs text-muted uppercase">
                  {PRICING_LABEL[set.startsWith("v2:") ? "v2" : "legacy"]} ·{" "}
                  {set.slice(set.indexOf(":") + 1)}
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Fees</TableHead>
                      <TableHead>Credits</TableHead>
                      <TableHead>Checkout</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <tbody>
                    {merged
                      .filter((m) => planSet(m.version) === set)
                      .map(({ version, states, steps }) => (
                        <TableRow key={version.id}>
                          <TableCell className="space-y-1 font-mono text-xs">
                            <span className="block">
                              v{version.version}{" "}
                              <Badge variant={STATE_BADGE[version.state]}>
                                {version.state}
                              </Badge>
                            </span>
                            {outOfStep(states) ? (
                              <RegionStates states={states} regions={regions} />
                            ) : null}
                            {outOfStep(states) &&
                            !needsSync(steps) &&
                            version.state === "draft" ? (
                              <span className="block text-muted normal-case">
                                Save or delete the draft again to bring every
                                region in line.
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell>{version.display_name}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {version.kind}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {fees(version)}
                          </TableCell>
                          <TableCell className="text-sm text-muted">
                            {credits(version)}
                          </TableCell>
                          <TableCell className="text-xs text-muted">
                            {checkoutLabel(version)}
                          </TableCell>
                          <TableCell className="space-x-2 text-right whitespace-nowrap">
                            {canWrite && needsSync(steps) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={locked}
                                onClick={() =>
                                  requestSync(
                                    version.id,
                                    `${version.family} v${version.version}`,
                                    syncVersionAction,
                                  )
                                }
                              >
                                Retry sync
                              </Button>
                            ) : null}
                            {canWrite && version.state === "draft" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={locked}
                                  onClick={() =>
                                    openEditor(
                                      draftFromVersion(version),
                                      version.id,
                                    )
                                  }
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={locked}
                                  onClick={() =>
                                    setConfirm({
                                      title: `Publish ${version.family} v${version.version}?`,
                                      description:
                                        version.pricing_version === "v2"
                                          ? "Every region holds this version for pricing v2. New customer entry uses it only after that region completes adoption and is explicitly released. The current v2 version is retired; existing assignments and contracts keep their terms. Published versions cannot be edited."
                                          : "New checkouts and assignments in every region use this version while legacy pricing is live. The current version is retired; existing contracts keep their terms. Published versions cannot be edited.",
                                      action: (reason) =>
                                        publishVersionAction(
                                          version.id,
                                          reason,
                                        ),
                                      done: `${version.family} v${version.version} published`,
                                    })
                                  }
                                >
                                  Publish
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={locked}
                                  onClick={() =>
                                    setConfirm({
                                      title: `Delete the ${version.family} v${version.version} draft?`,
                                      description:
                                        "The draft is discarded in every region. Published versions are not affected.",
                                      action: (reason) =>
                                        deleteDraftAction(version.id, reason),
                                      done: "Draft deleted",
                                    })
                                  }
                                >
                                  Delete
                                </Button>
                              </>
                            ) : null}
                            {canWrite && version.state !== "draft" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={locked}
                                onClick={() =>
                                  openEditor(draftFromVersion(version))
                                }
                              >
                                New draft from this
                              </Button>
                            ) : null}
                            {canWrite && version.state === "published" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={locked}
                                onClick={() =>
                                  setConfirm({
                                    title: `Retire ${version.family}?`,
                                    description:
                                      "The family stops being offered to new customers in every region and disappears from the pricing cards. Existing contracts and checkouts already started keep their terms.",
                                    action: (reason) =>
                                      retireVersionAction(version.id, reason),
                                    done: `${version.family} retired`,
                                  })
                                }
                              >
                                Retire
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                  </tbody>
                </Table>
              </section>
            ))}
          </>
        ) : null}
      </div>
      <ReasonDialog
        key={confirm?.title ?? "closed"}
        request={
          confirm
            ? {
                title: confirm.title,
                description: confirm.description,
                onConfirm: (reason) => run(confirm, reason),
              }
            : null
        }
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}
