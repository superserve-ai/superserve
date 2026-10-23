"use client"

import {
  Alert,
  Badge,
  Button,
  Input,
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
  type BillingCatalog,
  type MergedPromotion,
  type PlanDraft,
  type PlanVersion,
  type RegionState,
} from "@/lib/admin/billing-catalog"
import {
  deleteDraftAction,
  publishSignupPromotionAction,
  publishVersionAction,
  retireVersionAction,
  syncPromotionAction,
  syncVersionAction,
  type CatalogResult,
  type FanOutResult,
} from "@/lib/admin/billing-catalog-actions"
import { formatUsdCents } from "@/lib/billing/plans"
import { formatDate } from "@/lib/format"

import { centsFromDollars, PlanEditor } from "./plan-editor"
import { ReasonDialog } from "./reason-dialog"

const STATE_BADGE = {
  draft: "warning",
  published: "success",
  retired: "muted",
  missing: "destructive",
} as const

const PROMOTION_LABEL = {
  trial: "Trial credit (no card)",
  card_bonus: "Card bonus (replaces the trial)",
} as const

export const EMPTY_DRAFT: PlanDraft = {
  family: "",
  public: false,
  display_name: "",
  tagline: "",
  features: [],
  sort_order: 0,
  display_only: false,
  self_serve: false,
  monthly_fee_cents: null,
  annual_fee_cents: null,
  credit_schedule: [],
  matching: null,
  limits: {
    max_sandboxes: null,
    max_template_vcpu: null,
    max_template_memory_mib: null,
    max_template_disk_mib: null,
  },
}

type Confirmation = {
  title: string
  description: string
  action: (reason: string) => Promise<FanOutResult>
  done: string
  onDone?: () => void
}

type Editing = { draft: PlanDraft; id?: string; key: number }

function fees(version: PlanVersion) {
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

function PromotionRow({
  promotion,
  merged,
  regions,
  canWrite,
  locked,
  confirm,
  sync,
}: {
  promotion: "trial" | "card_bonus"
  merged: MergedPromotion[]
  regions: string[]
  canWrite: boolean
  locked: boolean
  confirm: (confirmation: Confirmation) => void
  sync: (id: string) => void
}) {
  const versions = merged.filter((m) => m.promotion.promotion === promotion)
  const current = versions.find((m) =>
    Object.values(m.states).includes("published"),
  )
  const earlier = versions.filter((m) => m !== current)
  const [amount, setAmount] = useState("")
  const cents = centsFromDollars(amount)
  return (
    <div className="space-y-3 border border-dashed border-border p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-muted uppercase">
            {PROMOTION_LABEL[promotion]}
          </p>
          <p className="mt-1 text-2xl font-medium">
            {current ? formatUsdCents(current.promotion.amount_cents) : "—"}
          </p>
          <p className="mt-1 text-xs text-muted">
            {current
              ? `v${current.promotion.version}${current.promotion.published_at ? ` · since ${formatDate(new Date(current.promotion.published_at))}` : ""}`
              : "No published amount"}
            {earlier.length
              ? ` · earlier: ${earlier.map((m) => `v${m.promotion.version} ${formatUsdCents(m.promotion.amount_cents)}`).join(", ")}`
              : ""}
          </p>
        </div>
        {canWrite ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (cents === null) return
              confirm({
                title: `Change the ${PROMOTION_LABEL[promotion].toLowerCase()}?`,
                description: `New grants in every region use ${formatUsdCents(cents)} instead of ${current ? formatUsdCents(current.promotion.amount_cents) : "the current amount"}. Credits already granted keep the amount they were granted with.`,
                action: (reason) =>
                  publishSignupPromotionAction(promotion, cents, reason),
                done: `${PROMOTION_LABEL[promotion]} set to ${formatUsdCents(cents)}`,
                onDone: () => setAmount(""),
              })
            }}
          >
            <Input
              aria-label={`New ${PROMOTION_LABEL[promotion]} in USD`}
              inputMode="decimal"
              placeholder="USD"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-28"
            />
            <Button
              size="sm"
              type="submit"
              disabled={
                locked || !cents || cents === current?.promotion.amount_cents
              }
            >
              Publish
            </Button>
          </form>
        ) : null}
      </div>
      {versions
        .filter((m) => needsSync(m.steps) || outOfStep(m.states))
        .map((m) => (
          <div
            key={m.promotion.id}
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <span>
              v{m.promotion.version} {formatUsdCents(m.promotion.amount_cents)}{" "}
              is not in the same state in every region
            </span>
            <RegionStates states={m.states} regions={regions} />
            {canWrite && needsSync(m.steps) ? (
              <Button
                size="sm"
                variant="outline"
                disabled={locked}
                onClick={() => sync(m.promotion.id)}
              >
                Retry sync
              </Button>
            ) : null}
          </div>
        ))}
    </div>
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
  const families = merged
    ? [...new Set(merged.versions.map((m) => m.version.family))]
    : []
  const locked = pending || editing !== null

  const openEditor = (draft: PlanDraft, id?: string) =>
    setEditing((current) => ({ draft, id, key: (current?.key ?? 0) + 1 }))

  const report = (result: FanOutResult, done: string, onDone?: () => void) => {
    const failed = failedRegions(result)
    if (failed) {
      addToast(
        `Not applied everywhere (${failed}). Use Retry sync to finish.`,
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
            <section aria-label="Signup credits" className="space-y-3">
              <h3 className="font-mono text-xs text-muted uppercase">
                Signup credits
              </h3>
              <p className="max-w-3xl text-sm text-muted">
                New amounts apply to grants made after publishing. Credits
                already granted keep the amount recorded when they were granted.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {(["trial", "card_bonus"] as const).map((promotion) => (
                  <PromotionRow
                    key={promotion}
                    promotion={promotion}
                    merged={merged.promotions}
                    regions={regions}
                    canWrite={canWrite}
                    locked={locked}
                    confirm={setConfirm}
                    sync={(id) =>
                      requestSync(
                        id,
                        PROMOTION_LABEL[promotion].toLowerCase(),
                        syncPromotionAction,
                      )
                    }
                  />
                ))}
              </div>
            </section>
            {families.map((family) => (
              <section
                key={family}
                aria-label={`${family} versions`}
                className="space-y-3"
              >
                <h3 className="font-mono text-xs text-muted uppercase">
                  {family}
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Fees</TableHead>
                      <TableHead>Credits</TableHead>
                      <TableHead>Checkout</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <tbody>
                    {merged.versions
                      .filter((m) => m.version.family === family)
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
                          <TableCell className="tabular-nums">
                            {fees(version)}
                          </TableCell>
                          <TableCell className="text-sm text-muted">
                            {version.preview.summary}
                            {version.matching
                              ? ` · ${version.matching.matching_bps / 100}% match up to ${formatUsdCents(version.matching.cap_cents)}`
                              : ""}
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
                                    `${family} v${version.version}`,
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
                                      title: `Publish ${family} v${version.version}?`,
                                      description:
                                        "New checkouts and assignments in every region use this version immediately. The current version is retired; existing contracts keep their terms. Published versions cannot be edited.",
                                      action: (reason) =>
                                        publishVersionAction(
                                          version.id,
                                          reason,
                                        ),
                                      done: `${family} v${version.version} published`,
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
                                      title: `Delete the ${family} v${version.version} draft?`,
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
                                    title: `Retire ${family}?`,
                                    description:
                                      "The family stops being offered to new customers in every region and disappears from the pricing cards. Existing contracts and checkouts already started keep their terms.",
                                    action: (reason) =>
                                      retireVersionAction(version.id, reason),
                                    done: `${family} retired`,
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
