import { render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  proof: vi.fn(),
  teams: vi.fn(),
  offer: vi.fn(),
  enabled: vi.fn(),
}))
vi.mock("@/lib/yc-claims", () => ({
  ycAccount: async () => ({ id: "user", email: "founder@example.test" }),
  ycRequest: mocks.request,
  ycProof: mocks.proof,
  ycTeams: mocks.teams,
}))
vi.mock("@/lib/yc/acceptance-api", () => ({
  journeyEnabled: mocks.enabled,
  readOffer: mocks.offer,
}))
vi.mock("./actions", () => ({ bindYCClaim: vi.fn(), prepareYCTeam: vi.fn() }))
import YCClaimPage from "./page"

const claim = {
  id: "claim",
  state: "bound",
  confirmation_status: "confirmed",
  team_id: "team",
  home_region: "use",
  evidence: {
    name: "Synthetic Founder",
    companies: [{ name: "Synthetic Company" }],
  },
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("YC_CLAIM_WEBSITE_URL", undefined)
  mocks.enabled.mockReturnValue(true)
  vi.stubEnv("YC_CONSOLE_JOURNEY_ENABLED", "true")
  mocks.offer.mockRejectedValue(new Error("new admission unavailable"))
  mocks.proof.mockResolvedValue({ id: "claim", token: "proof" })
  mocks.teams.mockResolvedValue([
    { teamId: "team", region: "use", name: "Synthetic Team" },
  ])
})
it.each([
  ["active", "Your YC Pro access is active"],
  ["awaiting_payment_method", "Add or update a usable payment method"],
  ["activation_pending", "Billing activation is pending"],
  ["renewed", "transitioned to its renewal plan"],
  ["requires_review", "billing activation requires Superserve review"],
  ["unavailable", "Billing status is temporarily unavailable"],
])(
  "renders authoritative billing state %s without attachment actions",
  async (state, message) => {
    mocks.request.mockImplementation(async (operation) => {
      if (operation === "claims") return { claims: [claim] }
      if (state === "unavailable") throw new Error("service unavailable")
      return { state, contract_id: "11111111-1111-4111-8111-111111111111" }
    })
    render(await YCClaimPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText(message, { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(
      screen.queryByText("Review offer and activation status"),
    ).not.toBeInTheDocument()
    expect(mocks.request).toHaveBeenCalledWith(
      "status",
      { id: "claim", user_id: "user", team_id: "team" },
      "use",
    )
    if (state !== "active")
      expect(
        screen.queryByText("Your YC Pro access is active", { exact: false }),
      ).not.toBeInTheDocument()
  },
)
it.each([
  { teams: [] },
  { teams: [{ teamId: "team", region: "use", name: "Synthetic Team" }] },
])(
  "expired confirmation hides both binding and setup actions",
  async ({ teams }) => {
    mocks.teams.mockResolvedValue(teams)
    mocks.request.mockResolvedValue({
      claims: [
        { ...claim, state: "confirmed", confirmation_status: "expired" },
      ],
    })
    render(await YCClaimPage({ searchParams: Promise.resolve({}) }))
    expect(
      screen.getByText("Your confirmation link has expired", { exact: false }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
  },
)
it("confirmed evidence offers explicit named team selection", async () => {
  mocks.request.mockResolvedValue({
    claims: [{ ...claim, state: "confirmed" }],
  })
  render(await YCClaimPage({ searchParams: Promise.resolve({}) }))
  expect(
    screen.getByRole("button", { name: "Attach claim to this team" }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole("option", { name: "Synthetic Team (use)" }),
  ).toHaveValue("use:team")
  expect(
    screen.queryByRole("button", { name: "Finish account setup" }),
  ).not.toBeInTheDocument()
})
it("confirmed evidence without a team offers only explicit setup", async () => {
  mocks.teams.mockResolvedValue([])
  mocks.request.mockResolvedValue({
    claims: [{ ...claim, state: "confirmed" }],
  })
  render(await YCClaimPage({ searchParams: Promise.resolve({}) }))
  expect(
    screen.getByRole("button", { name: "Finish account setup" }),
  ).toBeInTheDocument()
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
})

it("routes an approved preferred account through new admission without the legacy email gate", async () => {
  mocks.offer.mockResolvedValue({})
  mocks.request.mockImplementation(async (operation) =>
    operation === "claims"
      ? { claims: [claim] }
      : { state: "activation_pending" },
  )
  render(await YCClaimPage({ searchParams: Promise.resolve({}) }))
  expect(
    screen.getByRole("link", { name: "Review offer and activation status" }),
  ).toHaveAttribute("href", "/yc/accept?claim=claim")
  expect(mocks.request).toHaveBeenCalledTimes(1)
})

it.each([
  ["revocation_pending", 1, "Revocation pending"],
  ["revoked", 0, "Revocation confirmed"],
] as const)(
  "renders automated %s without legacy completion or activation claims",
  async (state, pending, title) => {
    mocks.request.mockResolvedValue({
      claims: [
        {
          ...claim,
          state: "revoked",
          financial_authority: {
            kind: "accepted_offer",
            state,
            pending_invalidations: pending,
          },
        },
      ],
    })
    render(await YCClaimPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument()
    expect(
      screen.queryByText(/Your approval has been revoked/),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("Review offer and activation status"),
    ).not.toBeInTheDocument()
    expect(mocks.offer).not.toHaveBeenCalled()
  },
)
it("preserves the legacy manual revoked claim message", async () => {
  mocks.request.mockResolvedValue({
    claims: [{ ...claim, state: "revoked", financial_authority: null }],
  })
  render(await YCClaimPage({ searchParams: Promise.resolve({}) }))
  expect(screen.getByText(/Your approval has been revoked/)).toBeInTheDocument()
  expect(
    screen.queryByRole("heading", { name: "Revocation confirmed" }),
  ).not.toBeInTheDocument()
})

it("routes acceptance pending through new admission and never falls back to legacy ready", async () => {
  mocks.request.mockResolvedValue({
    claims: [
      {
        ...claim,
        financial_authority: {
          kind: "accepted_offer",
          state: "acceptance_pending",
          pending_invalidations: 0,
        },
      },
    ],
  })
  mocks.offer.mockRejectedValue(new Error("unavailable"))
  render(await YCClaimPage({ searchParams: Promise.resolve({}) }))
  expect(
    screen.getByText(/Billing status is temporarily unavailable/),
  ).toBeInTheDocument()
  expect(screen.queryByText(/Revocation confirmed/)).not.toBeInTheDocument()
  expect(mocks.request).toHaveBeenCalledTimes(1)
})

it("does not fall back to legacy readiness for an automated claim when the journey is disabled", async () => {
  mocks.enabled.mockReturnValue(false)
  mocks.request.mockResolvedValue({
    claims: [
      {
        ...claim,
        financial_authority: {
          kind: "accepted_offer",
          state: "valid",
          pending_invalidations: 0,
        },
      },
    ],
  })
  render(await YCClaimPage({ searchParams: Promise.resolve({}) }))
  expect(
    screen.getByText(/Billing status is temporarily unavailable/),
  ).toBeInTheDocument()
  expect(mocks.offer).not.toHaveBeenCalled()
  expect(mocks.request).toHaveBeenCalledTimes(1)
})

it.each([
  [undefined, "https://www.superserve.ai/yc"],
  ["https://capture.example.test", "https://capture.example.test/yc"],
])(
  "renders the configured verification destination for an account without claims",
  async (origin, expected) => {
    vi.stubEnv("YC_CLAIM_WEBSITE_URL", origin)
    mocks.request.mockResolvedValue({ claims: [] })
    render(await YCClaimPage({ searchParams: Promise.resolve({}) }))
    expect(
      screen.getByRole("link", { name: "submit your YC verification" }),
    ).toHaveAttribute("href", expected)
  },
)
it("hides the verification link instead of routing to production when configuration is invalid", async () => {
  vi.stubEnv("YC_CLAIM_WEBSITE_URL", "http://capture.example.test")
  mocks.request.mockResolvedValue({ claims: [] })
  render(await YCClaimPage({ searchParams: Promise.resolve({}) }))
  expect(
    screen.queryByRole("link", { name: "submit your YC verification" }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByText(/New verification is temporarily unavailable/),
  ).toBeInTheDocument()
})
