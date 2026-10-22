import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { readRenewal } from "@/lib/yc/renewal-api"
import { ids, renewal } from "@/lib/yc/test-fixtures"

import RenewalPage from "./page"

vi.mock("@/lib/yc/renewal-api", async (original) => ({
  ...(await original<typeof import("@/lib/yc/renewal-api")>()),
  readRenewal: vi.fn(),
}))
vi.mock("./renewal-form", () => ({
  RenewalForm: ({ claim }: { claim: string }) => (
    <div data-testid="renewal-form">{claim}</div>
  ),
}))

beforeEach(() => {
  vi.mocked(readRenewal).mockReset().mockResolvedValue(renewal())
})
afterEach(() => vi.unstubAllEnvs())

it.each(["false", undefined])(
  "returns to the same claim's activation status when renewal is %s",
  async (setting) => {
    vi.stubEnv("YC_CONSOLE_RENEWAL_ENABLED", setting)
    render(
      await RenewalPage({
        searchParams: Promise.resolve({ claim: ids.claim }),
      }),
    )
    expect(
      screen.getByText(/Renewal choices are not available right now/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "View offer and access status" }),
    ).toHaveAttribute("href", `/yc/accept?claim=${ids.claim}`)
    expect(readRenewal).not.toHaveBeenCalled()
    expect(screen.queryByTestId("renewal-form")).not.toBeInTheDocument()
    expect(
      screen.queryByText(/A requested change is not confirmed/),
    ).not.toBeInTheDocument()
  },
)

it.each([
  undefined,
  "not-a-claim",
  "https://example.com/redirect",
  `${ids.claim}&next=/sandboxes`,
])(
  "does not propagate invalid locator %s into the disabled-page return",
  async (claim) => {
    vi.stubEnv("YC_CONSOLE_RENEWAL_ENABLED", "false")
    render(await RenewalPage({ searchParams: Promise.resolve({ claim }) }))
    expect(
      screen.getByRole("link", { name: "Find your claim" }),
    ).toHaveAttribute("href", "/yc/claim")
    expect(readRenewal).not.toHaveBeenCalled()
  },
)

it("preserves enabled renewal lookup and rendering", async () => {
  vi.stubEnv("YC_CONSOLE_RENEWAL_ENABLED", "true")
  render(
    await RenewalPage({ searchParams: Promise.resolve({ claim: ids.claim }) }),
  )
  expect(readRenewal).toHaveBeenCalledExactlyOnceWith(ids.claim)
  expect(screen.getByTestId("renewal-form")).toHaveTextContent(ids.claim)
  expect(
    screen.queryByText(/Renewal choices are not available right now/),
  ).not.toBeInTheDocument()
})

it("keeps enabled backend failures distinct from disabled renewal", async () => {
  vi.stubEnv("YC_CONSOLE_RENEWAL_ENABLED", "true")
  vi.mocked(readRenewal).mockRejectedValue(new Error("unavailable"))
  render(
    await RenewalPage({ searchParams: Promise.resolve({ claim: ids.claim }) }),
  )
  expect(screen.getByRole("alert")).toHaveTextContent(
    "We could not check your renewal options",
  )
  expect(
    screen.getByRole("link", { name: "Check your claim" }),
  ).toHaveAttribute("href", "/yc/claim")
})
