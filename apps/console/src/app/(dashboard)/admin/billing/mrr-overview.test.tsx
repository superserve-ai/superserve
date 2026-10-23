import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { combineMRR } from "@/lib/admin/billing-mrr"

import { MRROverviewView } from "./mrr-overview"

describe("MRROverviewView", () => {
  it("shows the total, plan rows and missing regions", () => {
    render(
      <MRROverviewView
        mrr={combineMRR([
          {
            region: "use",
            overview: {
              as_of: "2026-10-23T16:00:00Z",
              region: "use",
              currency: "usd",
              mrr_cents: 220000,
              teams: 12,
              revenue_teams: 2,
              plans: [
                {
                  key: "pro_monthly",
                  name: "Pro monthly",
                  teams: 1,
                  mrr_cents: 120000,
                },
                {
                  key: "pro_annual",
                  name: "Pro annual",
                  teams: 1,
                  mrr_cents: 100000,
                },
                { key: "payg", name: "Pay as you go", teams: 10, mrr_cents: 0 },
              ],
            },
          },
          { region: "usw", kind: "unavailable" },
        ])}
      />,
    )
    expect(screen.getByText("$2,200")).toBeTruthy()
    expect(screen.getByText("$26,400")).toBeTruthy()
    expect(
      screen.getByText(/Missing: usw \(unreachable or misconfigured/),
    ).toBeTruthy()
    expect(screen.getByText("55%")).toBeTruthy()
    expect(screen.getByText("Pay as you go")).toBeTruthy()
  })

  it("names the reason when no region answered", () => {
    render(
      <MRROverviewView
        mrr={combineMRR([
          { region: "use", kind: "unavailable" },
          { region: "usw", kind: "forbidden" },
        ])}
      />,
    )
    expect(
      screen.getByText(
        /use \(unreachable or misconfigured\), usw \(billing access refused\)/,
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/Retry/)).toBeNull()
  })
})
