export function GET(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/$/, "")
  if (path === "/api/fixture-logo" || path === "/logo.svg") {
    return new Response(process.env.SS640_FIXTURE_LOGO_SVG, {
      headers: { "Content-Type": "image/svg+xml" },
    })
  }
  if (path === "/api/billing/summary") {
    return Response.json({
      trial: {
        grant_usd: 5,
        consumed_usd: 0,
        remaining_usd: 5,
        state: "active",
        eligible: true,
        runway_state: "over_24h",
        runway_observed_at: new Date().toISOString(),
      },
      billing_mode: "live",
      checkout_available: true,
      portal_available: false,
      payment_setup_required: true,
      permissions: { can_view: true, can_manage: true },
      current_charges_usd: 0,
      credits_applied_usd: 0,
      credits_remaining_usd: 5,
      expected_invoice_amount_usd: 0,
      cost_breakdown_usd: { compute: 0, memory: 0, storage: 0 },
      resources: [],
      billing_period: {
        start: "2026-09-01T00:00:00.000Z",
        end: "2026-10-01T00:00:00.000Z",
      },
      pricing_tier: {
        plan_key: "payg",
        plan_name: "Pay as you go",
        currency: "usd",
      },
      calculated_at: new Date().toISOString(),
    })
  }
  return Response.json({
    user: { id: "ui-fixture-user", email: "fixture@example.test" },
    evidence: { status: "verified" },
    region: "use",
    team: null,
    credit: { granted: false, reason: "fixture-only" },
  })
}

export function POST(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/$/, "")
  if (path === "/api/stripe/checkout-session") {
    const cookieCase = request.headers
      .get("cookie")
      ?.split("; ")
      .find((entry) => entry.startsWith("ss640-ui-case="))
      ?.slice("ss640-ui-case=".length)
    if (cookieCase === "ss640-billing-evidence-unavailable-error") {
      return Response.json(
        {
          error: {
            code: "fixture_checkout_unavailable",
            message: "Synthetic checkout unavailable",
          },
        },
        { status: 503 },
      )
    }
    return Response.json({
      url: "http://127.0.0.1:4173/sandboxes/?billing=cancel",
    })
  }
  return Response.json({ ok: true, decision: "fixture-only", created: true })
}
