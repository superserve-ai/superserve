import { NextResponse } from "next/server"

const summary = {
  trial: { state: "active", remaining_usd: 3.25, runway_state: "over_24h" },
  billing_mode: "live",
  checkout_available: true,
  portal_available: false,
  payment_setup_required: true,
  permissions: { can_view: true, can_manage: true },
  current_charges_usd: 0,
  credits_applied_usd: 0,
  credits_remaining_usd: 3.25,
  expected_invoice_amount_usd: 0,
  cost_breakdown_usd: { compute: 0, memory: 0, storage: 0 },
  resources: [],
  billing_period: {
    start: "2026-09-01T00:00:00Z",
    end: "2026-10-01T00:00:00Z",
  },
  pricing_tier: {
    plan_key: "payg",
    plan_name: "Pay-as-you-go",
    currency: "USD",
  },
  calculated_at: "2026-09-25T00:00:00Z",
}

export function GET() {
  return NextResponse.json(summary)
}
