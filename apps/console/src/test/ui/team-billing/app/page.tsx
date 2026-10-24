import { TeamBillingView } from "@/app/(dashboard)/admin/billing/teams/[team_id]/team-billing-view"
import type {
  PlanCatalog,
  TeamPlan,
  TeamPlanAssignments,
} from "@/lib/admin/team-billing"

const team = "7c1e0a52-4b9d-4f3e-9a51-2f6d8c3b1e44"
const staff = "11111111-1111-4111-8111-111111111111"

const limits = {
  free: {
    max_concurrent: 1,
    max_vcpu: 1,
    max_memory_mib: 1024,
    max_disk_mib: 4096,
    max_templates: null,
  },
  starter: {
    max_concurrent: 100,
    max_vcpu: 2,
    max_memory_mib: 4096,
    max_disk_mib: 51200,
    max_templates: null,
  },
  pro: {
    max_concurrent: 1000,
    max_vcpu: 8,
    max_memory_mib: 32768,
    max_disk_mib: 102400,
    max_templates: null,
  },
}

const catalog: PlanCatalog = {
  pricingV2: true,
  freeLimits: limits.free,
  assignablePlans: [
    {
      id: "c0ffee00-0000-4000-8000-000000000103",
      family: "enterprise_example",
      version: 1,
      state: "published",
      kind: "custom",
      display_name: "Enterprise (example customer)",
      limits: { ...limits.pro, max_concurrent: 5000, max_vcpu: 16 },
    },
  ],
}

function plan(
  id: string,
  key: string,
  name: string,
  kind: string,
  from: string,
  to: string | null,
  source: string,
  reason: string,
): TeamPlan {
  return {
    id,
    plan_key: key,
    kind,
    terms: { display_name: name },
    limits:
      key === "pro_monthly"
        ? limits.pro
        : key === "starter"
          ? limits.starter
          : limits.free,
    effective_from: from,
    effective_to: to,
    source,
    reason,
  }
}

const freeAtSignup = plan(
  "c0ffee00-0000-4000-8000-000000000201",
  "free",
  "Free",
  "free",
  "2026-11-02T09:00:00Z",
  "2026-11-05T14:20:00Z",
  "signup",
  "",
)

const states: Record<string, TeamPlanAssignments> = {
  pro: {
    current: plan(
      "c0ffee00-0000-4000-8000-000000000202",
      "pro_monthly",
      "Pro",
      "subscription",
      "2026-11-05T14:20:00Z",
      null,
      "checkout",
      "",
    ),
    history: [],
    pending_change: {
      id: "c0ffee00-0000-4000-8000-000000000301",
      target_plan_key: "free",
      target_display_name: "Free",
      effective_at: "2026-12-05T14:20:00Z",
      undoable: true,
      pauses_running: true,
    },
  },
  starter: {
    current: plan(
      "c0ffee00-0000-4000-8000-000000000203",
      "starter",
      "Starter",
      "prepaid",
      "2026-11-05T14:20:00Z",
      null,
      "credit_purchase",
      "",
    ),
    history: [],
    pending_change: null,
  },
  legacy: { current: null, history: [], pending_change: null },
}
for (const s of [states.pro, states.starter])
  s.history = [s.current as TeamPlan, freeAtSignup]

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string
    switch?: string
    unavailable?: string
  }>
}) {
  const {
    state = "pro",
    switch: pricingSwitch,
    unavailable,
  } = await searchParams
  return (
    <main className="mx-auto max-w-5xl bg-background text-foreground">
      <TeamBillingView
        plans={unavailable === "plans" ? null : (states[state] ?? states.pro)}
        catalog={
          unavailable === "catalog"
            ? null
            : state === "legacy"
              ? { pricingV2: false, assignablePlans: [], freeLimits: null }
              : { ...catalog, pricingV2: pricingSwitch !== "off" }
        }
        staffCredits={
          unavailable === "credits"
            ? null
            : state === "legacy"
              ? []
              : [
                  {
                    id: "c0ffee00-0000-4000-8000-000000000011",
                    idempotency_key: "fixture-pending",
                    amount_cents: 5000,
                    reason: "Correction for a duplicated storage charge.",
                    requested_by: staff,
                    requested_at: "2026-10-21T09:30:00Z",
                    state: "pending" as const,
                    stripe_credit_grant_id: null,
                    issued_at: null,
                    last_error:
                      "stripe POST /v1/billing/credit_grants returned 503",
                  },
                  {
                    id: "c0ffee00-0000-4000-8000-000000000010",
                    idempotency_key: "fixture-issued",
                    amount_cents: 25000,
                    reason: "Usage billed twice during the September outage.",
                    requested_by: staff,
                    requested_at: "2026-10-02T10:00:00Z",
                    state: "issued",
                    stripe_credit_grant_id: "credgr_example",
                    issued_at: "2026-10-02T10:00:03Z",
                    last_error: null,
                  },
                ]
        }
        region="use"
        teamId={team}
        canWrite
      />
    </main>
  )
}
