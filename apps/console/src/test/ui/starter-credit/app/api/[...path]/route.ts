import { type NextRequest, NextResponse } from "next/server"

import { fixtureCookie, isScenario, prepaidFixture } from "../../../fixtures"

const headers = { "Cache-Control": "no-store" }

function scenarioOf(request: NextRequest) {
  const scenario = request.cookies.get(fixtureCookie)?.value
  return isScenario(scenario) ? scenario : null
}

export function GET(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/$/, "")
  const scenario = scenarioOf(request)
  if (!scenario)
    return NextResponse.json(
      { error: { code: "missing_fixture", message: "Select a fixture first" } },
      { status: 400 },
    )
  if (path === "/api/billing/plans/public")
    return NextResponse.json({ pricing_version: "v2", plans: [] }, { headers })
  if (path === "/api/billing/prepaid")
    return NextResponse.json(prepaidFixture(scenario), { headers })
  if (path === "/api/billing/summary")
    return NextResponse.json({ permissions: { can_manage: true } }, { headers })
  return NextResponse.json(
    {
      error: {
        code: "unsupported_fixture",
        message: "Unsupported fixture API",
      },
    },
    { status: 404 },
  )
}

export async function PUT(request: NextRequest) {
  const scenario = scenarioOf(request)
  if (!scenario) return NextResponse.json({}, { status: 400 })
  const input = await request.json()
  const summary = prepaidFixture(scenario)
  return NextResponse.json(
    {
      ...summary,
      purchases: [],
      auto_recharge: {
        ...summary.auto_recharge,
        enabled: input.enabled,
        threshold_cents: input.threshold_cents ?? null,
        amount_cents: input.amount_cents ?? null,
        disabled_reason: null,
        disabled_at: null,
      },
    },
    { headers },
  )
}

export function POST() {
  return NextResponse.json(
    {
      error: {
        code: "fixture",
        message: "Payments are simulated in this fixture",
      },
    },
    { status: 409 },
  )
}
