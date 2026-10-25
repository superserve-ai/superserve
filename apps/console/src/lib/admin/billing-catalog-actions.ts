"use server"

import { randomUUID } from "node:crypto"

import { z } from "zod"

import {
  adminBillingRequest,
  AdminBillingRequestError,
  requireAdminBilling,
  type AdminBillingErrorKind,
} from "@/lib/admin/billing-api"
import type { PricingVersion } from "@/lib/billing/plans"
import { configuredRegions } from "@/lib/cells"

import {
  billingCatalogSchema,
  catalogDrift,
  mergeCatalogs,
  nextVersionNumber,
  schedulePreviewSchema,
  termsKey,
  type BillingCatalog,
  type PlanDraft,
  type PlanVersion,
  type SchedulePreview,
} from "./billing-catalog"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CatalogResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

const MESSAGES: Record<AdminBillingErrorKind, string> = {
  forbidden: "You don't have access to change the billing catalog.",
  not_found: "That version no longer exists. Refresh to see the catalog.",
  conflict:
    "The catalog changed or that version is no longer a draft. Refresh and retry.",
  invalid: "The catalog rejected these terms. Check the fields and retry.",
  unavailable: "The billing catalog is unavailable. Retry shortly.",
  read_only_impersonation:
    "Stop impersonating the team to change the billing catalog.",
}

const anyBody = z.unknown()

async function attempt<T>(run: () => Promise<T>): Promise<CatalogResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (cause) {
    if (cause instanceof AdminBillingRequestError)
      return { ok: false, error: cause.detail ?? MESSAGES[cause.kind] }
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "Request failed",
    }
  }
}

function versionPath(id: string, suffix = "") {
  if (!UUID_RE.test(id)) throw new Error("Invalid version id")
  return `/internal/billing/catalog/plans/${id}${suffix}` as const
}

export async function getBillingCatalogsAction(): Promise<
  Record<string, CatalogResult<BillingCatalog>>
> {
  await requireAdminBilling("read")
  const regions = configuredRegions()
  const results = await Promise.all(
    regions.map((region) =>
      attempt(() =>
        adminBillingRequest({
          region,
          path: "/internal/billing/catalog",
          schema: billingCatalogSchema,
        }),
      ),
    ),
  )
  return Object.fromEntries(regions.map((region, i) => [region, results[i]!]))
}

export async function previewScheduleAction(
  region: string,
  schedule: PlanDraft["credit_schedule"],
): Promise<CatalogResult<SchedulePreview>> {
  return attempt(() =>
    adminBillingRequest({
      region,
      path: "/internal/billing/catalog/preview",
      query: new URLSearchParams({ credit_schedule: JSON.stringify(schedule) }),
      schema: schedulePreviewSchema,
    }),
  )
}

export interface FanOutResult {
  id?: string
  errors: Record<string, string>
}

function draftBody(version: PlanVersion | PlanDraft) {
  return {
    pricing_version: version.pricing_version,
    family: version.family,
    kind: version.kind,
    public: version.public,
    display_name: version.display_name,
    price_label: version.price_label,
    tagline: version.tagline,
    features: version.features,
    sort_order: version.sort_order,
    display_only: version.display_only,
    self_serve: version.self_serve,
    monthly_fee_cents: version.monthly_fee_cents,
    annual_fee_cents: version.annual_fee_cents,
    credit_schedule: version.credit_schedule,
    matching: version.matching,
    allowance: version.allowance,
    limits: version.limits,
  }
}

async function loadCatalogs(): Promise<Record<string, BillingCatalog>> {
  const results = await getBillingCatalogsAction()
  const catalogs: Record<string, BillingCatalog> = {}
  for (const [region, result] of Object.entries(results)) {
    if (!result.ok) throw new Error(`${region}: ${result.error}`)
    catalogs[region] = result.value
  }
  return catalogs
}

// Runs one change in every region. Retrying the same change is safe: every
// write is idempotent on the version id minted for it.
async function fanOut(
  regions: string[],
  run: (region: string) => Promise<unknown>,
  id?: string,
): Promise<FanOutResult> {
  const results = await Promise.all(
    regions.map((region) => attempt(() => run(region))),
  )
  const errors: Record<string, string> = {}
  regions.forEach((region, i) => {
    const result = results[i]!
    if (!result.ok) errors[region] = result.error
  })
  return { id, errors }
}

function failure(error: unknown): FanOutResult {
  return {
    errors: {
      all: error instanceof Error ? error.message : "Request failed",
    },
  }
}

function createIn(
  region: string,
  id: string,
  version: number,
  body: ReturnType<typeof draftBody>,
  reason: string,
) {
  return adminBillingRequest({
    region,
    path: "/internal/billing/catalog/plans",
    method: "POST",
    body: { ...body, id, version, reason },
    schema: anyBody,
  })
}

function transition(
  region: string,
  id: string,
  suffix: "/publish" | "/retire",
  reason: string,
  expected?: PlanVersion,
) {
  return adminBillingRequest({
    region,
    path: versionPath(id, suffix),
    method: "POST",
    body: { reason, ...(expected ? { expected: draftBody(expected) } : {}) },
    schema: anyBody,
  })
}

export async function createDraftAction(
  draft: PlanDraft,
  reason: string,
): Promise<FanOutResult> {
  try {
    const catalogs = await loadCatalogs()
    const id = randomUUID()
    const version = nextVersionNumber(catalogs, draft.family)
    const regions = Object.keys(catalogs)
    const result = await fanOut(
      regions,
      (region) => createIn(region, id, version, draftBody(draft), reason),
      id,
    )
    const failed = Object.keys(result.errors)
    if (!failed.length) return result
    // Another draft took this version number somewhere, or a region is
    // down: remove the copies just made so no region keeps a lone draft.
    await fanOut(
      regions.filter((region) => !failed.includes(region)),
      (region) =>
        adminBillingRequest({
          region,
          path: versionPath(id),
          method: "DELETE",
          body: { reason: `Undo partial create: ${reason}` },
          schema: anyBody,
        }),
    )
    return { errors: result.errors }
  } catch (error) {
    return failure(error)
  }
}

export async function updateDraftAction(
  id: string,
  draft: PlanDraft,
  reason: string,
): Promise<FanOutResult> {
  try {
    const catalogs = await loadCatalogs()
    const merged = mergeCatalogs(catalogs).find((v) => v.version.id === id)
    if (!merged) throw new Error("That draft no longer exists")
    if (
      Object.values(merged.states).some(
        (s) => s === "published" || s === "retired",
      )
    )
      throw new Error(
        "This version was already published, so it can no longer be edited.",
      )
    return fanOut(
      Object.keys(catalogs),
      (region) =>
        merged.states[region] === "missing"
          ? createIn(
              region,
              id,
              merged.version.version,
              draftBody(draft),
              reason,
            )
          : adminBillingRequest({
              region,
              path: versionPath(id),
              method: "PUT",
              body: { ...draftBody(draft), reason },
              schema: anyBody,
            }),
      id,
    )
  } catch (error) {
    return failure(error)
  }
}

export async function deleteDraftAction(
  id: string,
  reason: string,
): Promise<FanOutResult> {
  return fanOut(
    configuredRegions(),
    (region) =>
      adminBillingRequest({
        region,
        path: versionPath(id),
        method: "DELETE",
        body: { reason },
        schema: anyBody,
      }),
    id,
  )
}

// Publishing only proceeds when every region holds the same draft terms, so a
// partial save can never publish different terms in different regions.
export async function publishVersionAction(
  id: string,
  reason: string,
): Promise<FanOutResult> {
  try {
    const catalogs = await loadCatalogs()
    const copies = Object.entries(catalogs).map(
      ([region, catalog]) =>
        [region, catalog.plans.find((plan) => plan.id === id)] as const,
    )
    const missing = copies.filter(([, plan]) => !plan).map(([region]) => region)
    if (missing.length)
      throw new Error(
        `The draft is missing in ${missing.join(", ")}. Use Retry sync first.`,
      )
    if (copies.some(([, plan]) => plan!.state === "retired"))
      throw new Error(
        "This version was already replaced in another region, so it cannot be published again.",
      )
    if (new Set(copies.map(([, plan]) => termsKey(plan!))).size > 1)
      throw new Error("The draft differs between regions. Save it again first.")
    return fanOut(
      Object.keys(catalogs),
      (region) => transition(region, id, "/publish", reason, copies[0]![1]!),
      id,
    )
  } catch (error) {
    return failure(error)
  }
}

export async function retireVersionAction(
  id: string,
  reason: string,
): Promise<FanOutResult> {
  try {
    const catalogs = await loadCatalogs()
    if (
      Object.values(catalogs).some(
        (catalog) =>
          !catalog.plans.some(
            (plan) => plan.id === id && plan.state !== "draft",
          ),
      )
    )
      throw new Error(
        "This version is not published in every region. Use Retry sync first.",
      )
    const regions = Object.keys(catalogs)
    return fanOut(
      regions,
      (region) => transition(region, id, "/retire", reason),
      id,
    )
  } catch (error) {
    return failure(error)
  }
}

// Brings every region to the furthest state any region reached for the
// version, using the terms of that region's copy.
export async function syncVersionAction(
  id: string,
  reason: string,
): Promise<FanOutResult> {
  try {
    const catalogs = await loadCatalogs()
    const merged = mergeCatalogs(catalogs).find((v) => v.version.id === id)
    if (!merged) throw new Error("That version no longer exists")
    const source = merged.version
    const regions = Object.entries(merged.steps)
      .filter(([, steps]) => steps.length)
      .map(([region]) => region)
    return fanOut(
      regions,
      async (region) => {
        const copy = catalogs[region]!.plans.find((plan) => plan.id === id)
        if (copy && termsKey(copy) !== termsKey(source))
          throw new Error(
            "This region holds different terms for the version; delete or re-save that draft first.",
          )
        for (const step of merged.steps[region]!) {
          if (step === "create")
            await createIn(
              region,
              id,
              source.version,
              draftBody(source),
              reason,
            )
          else
            await transition(
              region,
              id,
              step === "publish" ? "/publish" : "/retire",
              reason,
              step === "publish" ? source : undefined,
            )
        }
      },
      id,
    )
  } catch (error) {
    return failure(error)
  }
}

// Switches the live pricing model in the given regions, or every region.
// Turning v2 on anywhere requires every region to publish the same v2
// catalog, so no region sells different terms. Repeating the switch is a
// no-op where it already took effect.
export async function setPricingVersionAction(
  pricingVersion: PricingVersion,
  reason: string,
  regions?: string[],
): Promise<FanOutResult> {
  try {
    const catalogs = await loadCatalogs()
    const targets = regions ?? Object.keys(catalogs)
    if (
      !targets.length ||
      targets.some((region) => !Object.hasOwn(catalogs, region))
    )
      throw new Error("Choose configured regions to switch")
    if (pricingVersion === "v2") {
      const drift = catalogDrift(catalogs).filter((set) =>
        set.startsWith("v2:"),
      )
      if (drift.length)
        throw new Error(
          `The v2 catalog differs between regions (${drift.join(", ")}). Retry sync first.`,
        )
    }
    return fanOut(targets, (region) =>
      adminBillingRequest({
        region,
        path: "/internal/billing/pricing-version",
        method: "POST",
        body: { pricing_version: pricingVersion, reason },
        schema: anyBody,
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
