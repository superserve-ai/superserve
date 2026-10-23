import { TeamBillingView } from "@/app/(dashboard)/admin/billing/teams/[team_id]/team-billing-view"
import type { TeamPlanBilling } from "@/lib/admin/team-billing"

const team = "7c1e0a52-4b9d-4f3e-9a51-2f6d8c3b1e44"
const plans: TeamPlanBilling["plan_options"] = [
  {
    offer_key: "starter_monthly",
    name: "Starter",
    fee_cents: 10000,
    interval_months: 1,
    monthly_credit_cents: 10000,
    available: false,
  },
  {
    offer_key: "starter_annual",
    name: "Starter",
    fee_cents: 100000,
    interval_months: 12,
    monthly_credit_cents: 10000,
    available: false,
  },
  {
    offer_key: "pro_monthly",
    name: "Pro",
    fee_cents: 120000,
    interval_months: 1,
    monthly_credit_cents: 100000,
    available: true,
  },
  {
    offer_key: "pro_annual",
    name: "Pro",
    fee_cents: 1200000,
    interval_months: 12,
    monthly_credit_cents: 100000,
    available: true,
  },
]
const day = (iso: string) => Math.floor(Date.parse(iso) / 1000)

const pro: TeamPlanBilling = {
  team_id: team,
  customer_id: "cus_example",
  subscription_id: "sub_example",
  subscription_status: "active",
  billing_anchor: "2026-03-14T09:00:00Z",
  period_start: "2026-10-14T09:00:00Z",
  period_end: "2026-11-14T09:00:00Z",
  contract: {
    id: "c0ffee00-0000-4000-8000-000000000001",
    offer_key: "pro_monthly",
    status: "active",
    starts_at: "2026-03-14T09:00:00Z",
    ends_at: null,
    charge_kind: "subscription",
    charge_amount_cents: 120000,
    charge_interval_months: 1,
    entitlement_amount_cents: 100000,
    entitlement_cadence: "monthly",
  },
  pending_change: {
    id: "c0ffee00-0000-4000-8000-000000000002",
    target_offer: "pro_annual",
    terms: {
      offer_key: "pro_annual",
      fee_cents: 1200000,
      interval_months: 12,
      monthly_credit_cents: 100000,
    },
    effective_at: "2027-03-14T09:00:00Z",
    state: "scheduled",
    requested_by: "11111111-1111-4111-8111-111111111111",
    requested_at: "2026-10-20T15:12:00Z",
    reason:
      "Customer asked to move to annual billing at their next yearly anniversary.",
    deferrals: 0,
    cancelable: true,
    canceled_at: null,
    cancel_reason: null,
    last_error: null,
  },
  changes: [],
  credits: [
    {
      period_start: "2026-10-14T09:00:00Z",
      period_end: "2026-11-14T09:00:00Z",
      amount_cents: 100000,
      state: "issued",
      grant_id: "credgr_example",
      remaining_cents: 61840,
    },
  ],
  card: { brand: "visa", last4: "4242", exp_month: 8, exp_year: 2029 },
  invoices: [
    {
      id: "in_example_3",
      number: "EXAMPLE-0007",
      status: "paid",
      total_cents: 131250,
      amount_paid_cents: 131250,
      created: day("2026-10-14T10:02:00Z"),
      period_start: day("2026-09-14T09:00:00Z"),
      period_end: day("2026-10-14T09:00:00Z"),
      hosted_invoice_url: "",
    },
    {
      id: "in_example_2",
      number: "EXAMPLE-0006",
      status: "paid",
      total_cents: 120000,
      amount_paid_cents: 120000,
      created: day("2026-09-14T10:05:00Z"),
      period_start: day("2026-08-14T09:00:00Z"),
      period_end: day("2026-09-14T09:00:00Z"),
      hosted_invoice_url: "",
    },
  ],
  plan_options: plans,
}
pro.changes = [
  pro.pending_change!,
  {
    ...pro.pending_change!,
    id: "c0ffee00-0000-4000-8000-000000000003",
    target_offer: "pro_monthly",
    terms: {
      offer_key: "pro_monthly",
      fee_cents: 120000,
      interval_months: 1,
      monthly_credit_cents: 100000,
    },
    effective_at: "2026-03-14T09:00:00Z",
    state: "completed",
    requested_at: "2026-03-02T11:40:00Z",
    reason: "Upgrade from pay-as-you-go after the pilot.",
    cancelable: false,
  },
]

const payg: TeamPlanBilling = {
  ...pro,
  contract: null,
  pending_change: null,
  changes: [],
  credits: [],
  invoices: pro.invoices.map((i) => ({
    ...i,
    total_cents: 4321,
    amount_paid_cents: 4321,
  })),
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams
  return (
    <main className="mx-auto max-w-5xl bg-background text-foreground">
      <TeamBillingView
        view={state === "payg" ? payg : pro}
        staffCredits={
          state === "payg"
            ? []
            : [
                {
                  id: "c0ffee00-0000-4000-8000-000000000010",
                  amount_cents: 25000,
                  reason: "Usage billed twice during the September outage.",
                  requested_by: "11111111-1111-4111-8111-111111111111",
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
