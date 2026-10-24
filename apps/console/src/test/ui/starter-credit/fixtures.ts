export const fixtureCookie = "starter_ui_scenario"
export const scenarios = ["first", "active", "declined", "rollback"] as const
export type Scenario = (typeof scenarios)[number]

export function isScenario(value: unknown): value is Scenario {
  return (
    typeof value === "string" &&
    (scenarios as readonly string[]).includes(value)
  )
}

const at = (daysAgo: number) =>
  new Date(Date.UTC(2026, 9, 23) - daysAgo * 86_400_000).toISOString()

export function prepaidFixture(scenario: Scenario) {
  if (scenario === "first")
    return {
      balance_cents: 0,
      low_balance: true,
      has_saved_card: false,
      auto_recharge: {
        enabled: false,
        threshold_cents: null,
        amount_cents: null,
        disabled_reason: null,
        disabled_at: null,
        in_flight: false,
      },
      purchases: [],
    }
  const purchases = [
    {
      id: "6b1d3c2e-0000-4000-8000-000000000003",
      source: "auto_recharge",
      amount_cents: 2500,
      state: scenario === "declined" ? "failed" : "credited",
      failure_reason:
        scenario === "declined"
          ? "the saved card was declined or needs authentication"
          : null,
      paid_at: scenario === "declined" ? null : at(1),
      credited_at: scenario === "declined" ? null : at(1),
      created_at: at(1),
    },
    {
      id: "6b1d3c2e-0000-4000-8000-000000000002",
      source: "checkout",
      amount_cents: 5000,
      state: "credited",
      failure_reason: null,
      paid_at: at(9),
      credited_at: at(9),
      created_at: at(9),
    },
    {
      id: "6b1d3c2e-0000-4000-8000-000000000001",
      source: "checkout",
      amount_cents: 2500,
      state: "credited",
      failure_reason: null,
      paid_at: at(20),
      credited_at: at(20),
      created_at: at(20),
    },
  ]
  return {
    balance_cents: scenario === "declined" ? 350 : 4250,
    low_balance: scenario === "declined",
    has_saved_card: true,
    auto_recharge:
      scenario === "declined"
        ? {
            enabled: false,
            threshold_cents: 1000,
            amount_cents: 2500,
            disabled_reason:
              "the saved card was declined or needs authentication",
            disabled_at: at(1),
            in_flight: false,
          }
        : {
            enabled: true,
            threshold_cents: 1000,
            amount_cents: 2500,
            disabled_reason: null,
            disabled_at: null,
            in_flight: false,
          },
    purchases,
  }
}
