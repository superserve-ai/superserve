import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { readOffer } from "@/lib/yc/acceptance-api"
import { ids, offered } from "@/lib/yc/test-fixtures"

import AcceptOfferPage from "./page"

vi.mock("@/lib/yc/acceptance-api", async (original) => ({
  ...(await original<typeof import("@/lib/yc/acceptance-api")>()),
  readOffer: vi.fn(),
}))
vi.mock("./actions", () => ({
  submitAcceptance: vi.fn(),
  refreshAcceptance: vi.fn(),
  openOfferBilling: vi.fn(),
  openReadyOfferConsole: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(readOffer).mockResolvedValue(
    offered({ state: "accepted", accepted_at: "2026-10-21T12:00:00Z" }),
  )
})
afterEach(() => vi.unstubAllEnvs())

it.each(["true", "false", undefined])(
  "uses the server renewal setting %s for offer navigation",
  async (setting) => {
    vi.stubEnv("YC_CONSOLE_RENEWAL_ENABLED", setting)
    render(
      await AcceptOfferPage({
        searchParams: Promise.resolve({ claim: ids.claim }),
      }),
    )
    const link = screen.queryByRole("link", { name: "Review your next plan" })
    if (setting === "true")
      expect(link).toHaveAttribute("href", `/yc/renewal?claim=${ids.claim}`)
    else expect(link).not.toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Offer accepted" }),
    ).toBeInTheDocument()
  },
)
