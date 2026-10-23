import "server-only"
import * as z from "zod"

import { cellFor, DEFAULT_REGION } from "@/lib/cells"

import { FALLBACK_PLAN_CATALOG, type PlanCatalog } from "./plan-catalog"
import { isPurchaseOffer } from "./signup-plan"

const nullableInt = z.number().int().nonnegative().nullable()

const plansSchema = z.object({
  plans: z.array(
    z.object({
      key: z.string(),
      family: z.enum(["starter", "pro"]),
      name: z.string().min(1).max(100),
      interval_months: z.number().int().positive(),
      price_cents: z.number().int().nonnegative(),
      monthly_credit_cents: nullableInt.optional(),
      limits: z.object({
        max_sandboxes: nullableInt.optional(),
        max_template_vcpu: nullableInt.optional(),
        max_template_memory_mib: nullableInt.optional(),
        max_template_disk_mib: nullableInt.optional(),
      }),
    }),
  ),
})

/**
 * Public plan prices and limits from the billing API, overlaid on the
 * fallback copy. Plans the API does not list keep their fallback entry so the
 * picker can still describe them.
 */
export async function readPlanCatalog(): Promise<PlanCatalog> {
  const catalog = { ...FALLBACK_PLAN_CATALOG }
  try {
    const response = await fetch(
      `${cellFor(DEFAULT_REGION).apiBaseUrl}/billing/plans/public`,
      {
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(3000),
      },
    )
    if (!response.ok) throw new Error(`status ${response.status}`)
    const parsed = plansSchema.parse(await response.json())
    for (const plan of parsed.plans) {
      if (!isPurchaseOffer(plan.key) || !plan.key.startsWith(plan.family))
        continue
      catalog[plan.key] = {
        key: plan.key,
        family: plan.family,
        name: plan.name,
        interval_months: plan.interval_months,
        price_cents: plan.price_cents,
        monthly_credit_cents: plan.monthly_credit_cents ?? null,
        limits: {
          max_sandboxes: plan.limits.max_sandboxes ?? null,
          max_template_vcpu: plan.limits.max_template_vcpu ?? null,
          max_template_memory_mib: plan.limits.max_template_memory_mib ?? null,
          max_template_disk_mib: plan.limits.max_template_disk_mib ?? null,
        },
      }
    }
  } catch (error) {
    console.warn("Plan catalog unavailable; using fallback copy", {
      error: error instanceof Error ? error.message : "unknown_error",
    })
  }
  return catalog
}
