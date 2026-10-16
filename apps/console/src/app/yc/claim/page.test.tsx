import { render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  proof: vi.fn(),
  teams: vi.fn(),
}))
vi.mock("@/lib/yc-claims", () => ({
  ycAccount: async () => ({ id: "user", email: "founder@example.test" }),
  ycRequest: mocks.request,
  ycProof: mocks.proof,
  ycTeams: mocks.teams,
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
      return { state }
    })
    render(await YCClaimPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText(message, { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
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
