import { type NextRequest, NextResponse } from "next/server"

import {
  billingFixture,
  fixtureCookie,
  isScenario,
  usageFixture,
} from "../../../fixtures"

export function GET(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/$/, "")
  if (path === "/api/fixture-health")
    return NextResponse.json({ fixture: "ss669-storage-billing" })
  const scenario = request.cookies.get(fixtureCookie)?.value
  if (!isScenario(scenario)) {
    return NextResponse.json(
      {
        error: {
          code: "missing_fixture",
          message: "Select a billing fixture first",
        },
      },
      { status: 400 },
    )
  }
  const { summary, pricing } = billingFixture(scenario)
  const headers = { "Cache-Control": "no-store" }
  if (path === "/api/billing/summary")
    return NextResponse.json(summary, { headers })
  if (path === "/api/billing/pricing")
    return NextResponse.json(pricing, { headers })
  if (path === "/api/billing/usage-series")
    return NextResponse.json(
      usageFixture(scenario, request.nextUrl.searchParams),
      { headers },
    )
  if (path === "/api/teams/storage-ui-team/billing/periods")
    return NextResponse.json({ periods: [] }, { headers })
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
