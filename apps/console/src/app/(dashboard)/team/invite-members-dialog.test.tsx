import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  refresh: vi.fn(),
  displayed: vi.fn(),
  teams: vi.fn(),
}))
vi.mock("@/hooks/use-teams", () => ({ useTeams: mocks.teams }))
vi.mock("@/hooks/use-team-management", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-team-management")>()),
  useDisplayedTeam: mocks.displayed,
  useCreateInvitation: () => ({
    mutateAsync: mocks.create,
    refreshInvitations: mocks.refresh,
    reset: vi.fn(),
  }),
}))

import { TEAM_CHANGED_MESSAGE } from "@/hooks/use-team-management"

import { InviteMembersDialog } from "./invite-members-dialog"

const team = { teamId: "team-1", region: "use" }
const allRoles = [
  "team_owner",
  "billing_admin",
  "viewer",
  "user_admin",
  "team_admin",
  "unknown",
]
function setup(roles: string[] | undefined = allRoles) {
  return render(
    <InviteMembersDialog
      team={team}
      invitableRoles={roles}
      onOpenChange={vi.fn()}
    />,
  )
}
function paste(text: string) {
  fireEvent.paste(screen.getByLabelText("Email addresses"), {
    clipboardData: { getData: () => text },
  })
}
function send() {
  fireEvent.click(screen.getByRole("button", { name: "Send invites" }))
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.displayed.mockReturnValue(team)
  mocks.teams.mockReturnValue({
    data: {
      teams: [{ id: team.teamId, name: "Project team", region: team.region }],
    },
  })
  mocks.create.mockResolvedValue({ ok: true, delivery: "sent" })
})

describe("InviteMembersDialog", () => {
  it("names the invitation's team in the title and read-only team line", () => {
    setup()
    expect(
      screen.getByRole("heading", { name: "Invite people to Project team" }),
    ).toHaveAttribute("title", "Project team")
    expect(screen.getByText("Team:").parentElement).toHaveTextContent(
      "Team: Project team",
    )
    expect(screen.getByText("Project team")).toHaveAttribute(
      "title",
      "Project team",
    )
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument()
  })

  it.each([
    [{ id: "team-2", name: "Other team", region: "use" }, "Project team"],
    [
      { id: "team-1", name: "Other team", region: "usw" },
      "Project team · US East",
    ],
  ])(
    "labels and sends to the prop's scope when the active team is %j",
    async (other, label) => {
      mocks.teams.mockReturnValue({
        data: {
          activeTeamId: other.id,
          activeRegion: other.region,
          teams: [
            other,
            { id: team.teamId, name: "Project team", region: team.region },
          ],
        },
      })
      setup()
      expect(
        screen.getByRole("heading", { name: `Invite people to ${label}` }),
      ).toBeInTheDocument()
      expect(screen.getByText("Team:").parentElement).toHaveTextContent(
        `Team: ${label}`,
      )
      expect(screen.queryByText(/Other team/)).not.toBeInTheDocument()
      paste("one@example.com")
      send()
      await waitFor(() =>
        expect(mocks.create).toHaveBeenCalledWith({
          team,
          email: "one@example.com",
          role: "team_admin",
        }),
      )
    },
  )

  it.each([
    undefined,
    { teams: [] },
    { teams: [{ id: "team-2", name: "Other team", region: "use" }] },
    { teams: [{ id: "team-1", name: "Other region", region: "usw" }] },
    { teams: [{ id: "team-1", name: " ", region: "use" }] },
  ])("uses the generic title when the directory has no name: %j", (data) => {
    mocks.teams.mockReturnValue({ data })
    setup()
    expect(
      screen.getByRole("heading", { name: "Invite people" }),
    ).toBeInTheDocument()
    expect(screen.queryByText("Team:")).not.toBeInTheDocument()
  })

  it("keeps the full long team name available on the title and team line", () => {
    const name = "Project team ".repeat(30).trim()
    mocks.teams.mockReturnValue({
      data: { teams: [{ id: team.teamId, name, region: team.region }] },
    })
    setup()
    expect(screen.getAllByTitle(name)).toHaveLength(2)
    expect(
      screen.getByRole("heading", { name: `Invite people to ${name}` }),
    ).toBeInTheDocument()
  })

  it("splits pasted addresses, deduplicates, flags invalid rows and removes rows", () => {
    setup()
    paste(
      "one@example.com, TWO@example.com;one@EXAMPLE.com\ninvalid three@example.com",
    )
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(4)
    expect(screen.getByText("Duplicate addresses ignored.")).toBeInTheDocument()
    expect(screen.getByText("Invalid email")).toBeInTheDocument()
    expect(screen.getByLabelText("Email for invalid")).toHaveValue("invalid")
    expect(screen.getByText("one@example.com")).toHaveAttribute("data-mask")
    fireEvent.click(screen.getByRole("button", { name: "Remove invalid" }))
    expect(screen.queryByText("Invalid email")).not.toBeInTheDocument()
  })
  it.each(["Enter", "Tab", ",", ";", " "])("adds an address with %j", (key) => {
    setup()
    fireEvent.change(screen.getByLabelText("Email addresses"), {
      target: { value: "one@example.com" },
    })
    fireEvent.keyDown(screen.getByLabelText("Email addresses"), { key })
    expect(screen.getByText("one@example.com")).toBeInTheDocument()
  })
  it("adds on blur and keeps invalid addresses visible and unsendable until edited", () => {
    setup()
    fireEvent.change(screen.getByLabelText("Email addresses"), {
      target: { value: "invalid" },
    })
    fireEvent.blur(screen.getByLabelText("Email addresses"))
    expect(screen.getByText("Invalid email")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send invites" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Email for invalid"), {
      target: { value: "valid@example.com" },
    })
    expect(screen.getByRole("button", { name: "Send invites" })).toBeEnabled()
  })
  it("keeps the email editor open until blur when fixing a failed row", async () => {
    mocks.create.mockRejectedValueOnce({ code: "already_member" })
    setup()
    paste("one@example.com")
    send()
    await screen.findByText("Already a member")
    expect(
      screen.queryByRole("button", { name: /Send invites|Retry failed/ }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Email for one@example.com"), {
      target: { value: "other@example.c" },
    })
    const input = screen.getByLabelText("Email for other@example.c")
    expect(input).toBeInTheDocument()
    fireEvent.change(input, { target: { value: "other@example.com" } })
    fireEvent.blur(input)
    expect(screen.getByText("other@example.com")).toHaveAttribute("data-mask")
    expect(screen.queryByText("Already a member")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send invites" })).toBeEnabled()
    send()
    await screen.findByText("Sent")
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.create).toHaveBeenLastCalledWith({
      team,
      email: "other@example.com",
      role: "team_admin",
    })
  })

  it("defaults new rows to Team admin with allowed known options in display order", async () => {
    const user = userEvent.setup()
    setup()
    paste("one@example.com two@example.com")
    const select = screen.getByRole("combobox", {
      name: "Role for one@example.com",
    })
    expect(select).toHaveTextContent("Team admin")
    expect(screen.getByLabelText("Role for two@example.com")).toHaveTextContent(
      "Team admin",
    )
    await user.click(select)
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Team admin", "User admin", "Billing admin", "Viewer", "Owner"])
    expect(
      screen.getAllByText(
        "Create sandboxes and API keys and manage settings. Can remove members who are not Owners or Team admins, but cannot invite or change roles.",
      ),
    ).toHaveLength(2)
  })
  it("summarizes a partial send and hides the primary button when errors are permanent", async () => {
    mocks.create
      .mockResolvedValueOnce({ delivery: "sent" })
      .mockRejectedValueOnce({ code: "already_member" })
    setup()
    paste("one@example.com two@example.com")
    send()
    expect(
      await screen.findByText("1 sent. 1 needs attention."),
    ).toBeInTheDocument()
    expect(screen.getByText("Already a member")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Send invites|Retry failed/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Close", { selector: "button" })).toBeEnabled()
  })
  it("retries only the retryable row when permanent and generic errors are mixed", async () => {
    mocks.create
      .mockRejectedValueOnce({ code: "already_member" })
      .mockRejectedValueOnce({ status: 500 })
    setup()
    paste("one@example.com two@example.com")
    send()
    await screen.findByText("2 need attention.")
    expect(screen.getByText("Already a member")).toBeInTheDocument()
    expect(
      screen.getByText("Something went wrong. Please try again."),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry failed" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Retry failed" }))
    await screen.findByText("1 sent. 1 needs attention.")
    expect(mocks.create).toHaveBeenCalledTimes(3)
    expect(mocks.create).toHaveBeenLastCalledWith({
      team,
      email: "two@example.com",
      role: "team_admin",
    })
    expect(screen.getByText("Already a member")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Send invites|Retry failed/ }),
    ).not.toBeInTheDocument()
  })
  it("hides the primary button after every invitation was sent", async () => {
    setup()
    paste("one@example.com two@example.com")
    send()
    await screen.findByText("2 sent.")
    expect(
      screen.queryByRole("button", { name: /Send invites|Retry failed/ }),
    ).not.toBeInTheDocument()
  })
  it("does not retry invitations whose delivery failed", async () => {
    mocks.create.mockResolvedValueOnce({ delivery: "failed" })
    setup()
    paste("one@example.com")
    send()
    await screen.findByText("1 needs attention.")
    expect(screen.getByText("Invite created, email failed")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Send invites|Retry failed/ }),
    ).not.toBeInTheDocument()
  })
  it("offers Send invites when a new address is added after sending", async () => {
    setup()
    paste("one@example.com")
    send()
    await screen.findByText("1 sent.")
    paste("two@example.com")
    expect(screen.getByRole("button", { name: "Send invites" })).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: "Retry failed" }),
    ).not.toBeInTheDocument()
    send()
    await screen.findByText("2 sent.")
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.create).toHaveBeenLastCalledWith({
      team,
      email: "two@example.com",
      role: "team_admin",
    })
  })
  it("counts rows skipped for invalid addresses as needing attention", async () => {
    mocks.create.mockResolvedValueOnce({ delivery: "sent" })
    setup()
    paste("one@example.com not-an-email")
    send()
    expect(
      await screen.findByText("1 sent. 1 needs attention."),
    ).toBeInTheDocument()
  })
  it.each([
    [["team_owner", "billing_admin", "user_admin", "viewer"], "Viewer"],
    [["team_owner", "billing_admin", "user_admin"], "Billing admin"],
    [["team_owner", "user_admin"], "User admin"],
    [["team_owner", "team_admin"], "Team admin"],
  ])("uses the preferred available role in %j", async (roles, expected) => {
    const user = userEvent.setup()
    setup(roles)
    paste("one@example.com")
    const select = screen.getByRole("combobox")
    expect(select).toHaveTextContent(expected)
    await user.click(select)
    expect(screen.getAllByRole("option")).toHaveLength(roles.length)
  })
  it("requires choosing Owner deliberately when it is the only role", async () => {
    const user = userEvent.setup()
    setup(["team_owner"])
    paste("one@example.com")
    const select = screen.getByRole("combobox")
    expect(select).toHaveTextContent("Choose role")
    expect(screen.getByRole("button", { name: "Send invites" })).toBeDisabled()
    await user.click(select)
    expect(screen.getAllByRole("option")).toHaveLength(1)
    await user.click(screen.getByRole("option", { name: "Owner" }))
    expect(select).toHaveTextContent("Owner")
    expect(screen.getByRole("button", { name: "Send invites" })).toBeEnabled()
    expect(select).not.toHaveTextContent("Choose role")
    send()
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        team,
        email: "one@example.com",
        role: "team_owner",
      }),
    )
  })
  it("opens the role select with the keyboard and chooses with Enter", async () => {
    const user = userEvent.setup()
    setup()
    paste("one@example.com")
    const select = screen.getByRole("combobox", {
      name: "Role for one@example.com",
    })
    await waitFor(() =>
      expect(screen.getByLabelText("Email addresses")).toHaveFocus(),
    )
    await user.tab()
    expect(select).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    await user.keyboard("{ArrowDown}{Enter}")
    expect(select).toHaveTextContent("User admin")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })
  it("clears a failed row's message when its role changes and sends the new role", async () => {
    const user = userEvent.setup()
    mocks.create.mockRejectedValueOnce({ code: "invalid_role" })
    setup()
    paste("one@example.com")
    send()
    await screen.findByText("Role not allowed")
    const select = screen.getByRole("combobox", {
      name: "Role for one@example.com",
    })
    await user.click(select)
    await user.click(screen.getByRole("option", { name: "Viewer" }))
    expect(select).toHaveTextContent("Viewer")
    expect(screen.queryByText("Role not allowed")).not.toBeInTheDocument()
    send()
    await screen.findByText("Sent")
    expect(mocks.create).toHaveBeenLastCalledWith({
      team,
      email: "one@example.com",
      role: "viewer",
    })
  })
  it("blocks sending with no known allowed roles", () => {
    setup(["future_role"])
    paste("one@example.com")
    expect(screen.getByRole("button", { name: "Send invites" })).toBeDisabled()
  })
  it("hides the legacy Owner notice when invitable roles are provided", () => {
    setup()
    expect(
      screen.queryByText(
        "Invites join as Owner with full access to this team.",
      ),
    ).not.toBeInTheDocument()
  })
  it("omits selectors and role payloads on the old backend", async () => {
    render(<InviteMembersDialog team={team} onOpenChange={vi.fn()} />)
    paste("one@example.com two@example.com")
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(
      screen.getByText("Invites join as Owner with full access to this team."),
    ).toBeInTheDocument()
    send()
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2))
    expect(mocks.create.mock.calls.map(([value]) => value)).toEqual([
      { team, email: "one@example.com" },
      { team, email: "two@example.com" },
    ])
  })
  it("sends sequentially, locks controls, keeps results, refreshes after the loop and sends edited failures", async () => {
    let resolveFirst!: (value: unknown) => void
    mocks.create
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce({ delivery: "failed" })
      .mockRejectedValueOnce({ code: "already_member" })
    setup()
    paste("one@example.com two@example.com three@example.com invalid")
    send()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Email addresses")).toBeDisabled()
    expect(screen.getByLabelText("Email for invalid")).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Remove one@example.com" }),
    ).toBeDisabled()
    expect(
      screen.getByRole("combobox", { name: "Role for one@example.com" }),
    ).toBeDisabled()
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled()
    await act(async () => resolveFirst({ delivery: "sent" }))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(screen.getByText("Sent")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Remove one@example.com" }),
    ).toBeDisabled()
    expect(screen.getByText("Invite created, email failed")).toBeInTheDocument()
    expect(
      screen.getByRole("combobox", { name: "Role for one@example.com" }),
    ).toBeDisabled()
    expect(
      screen.getByRole("combobox", { name: "Role for two@example.com" }),
    ).toBeDisabled()
    expect(screen.getByText("Already a member")).toBeInTheDocument()
    expect(mocks.create).toHaveBeenCalledTimes(3)
    expect(mocks.create.mock.calls[0][0]).toEqual({
      team,
      email: "one@example.com",
      role: "team_admin",
    })
    expect(
      screen.queryByRole("button", { name: /Send invites|Retry failed/ }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Email for three@example.com"), {
      target: { value: "fixed@example.com" },
    })
    send()
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(4))
    expect(mocks.create.mock.calls[3][0].email).toBe("fixed@example.com")
    expect(screen.getAllByText("Sent")).toHaveLength(2)
  })
  it.each([
    ["already_member", "Already a member", false],
    ["invitation_pending", "Already invited", false],
    ["invalid_role", "Role not allowed", false],
    ["rate_limited", "Too many invites sent. Try again later.", true],
    ["bad_request", "Invalid email", false],
    ["pending_limit", "Too many pending invites", false],
    ["free_plan", "Upgrade to invite members", false],
    ["unavailable", "Something went wrong. Please try again.", true],
  ])("maps %s and respects retryability", async (code, message, retryable) => {
    mocks.create.mockRejectedValueOnce({ code })
    setup()
    paste("one@example.com")
    send()
    expect(await screen.findByText(message)).toBeInTheDocument()
    if (retryable) {
      fireEvent.click(screen.getByRole("button", { name: "Retry failed" }))
      expect(await screen.findByText("Sent")).toBeInTheDocument()
      expect(mocks.create).toHaveBeenCalledTimes(2)
    } else {
      await screen.findByText("1 needs attention.")
      expect(
        screen.queryByRole("button", { name: /Send invites|Retry failed/ }),
      ).not.toBeInTheDocument()
      expect(mocks.create).toHaveBeenCalledOnce()
    }
  })
  it("stops on team_changed and marks remaining rows", async () => {
    mocks.create.mockRejectedValueOnce({ code: "team_changed" })
    setup()
    paste("one@example.com two@example.com three@example.com")
    send()
    await waitFor(() =>
      expect(screen.getAllByText(TEAM_CHANGED_MESSAGE)).toHaveLength(3),
    )
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.refresh).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: "Retry failed" }))
    await screen.findByText("3 sent.")
    expect(mocks.create).toHaveBeenCalledTimes(4)
  })
  it.each([20, 22])(
    "shows one limit message after pasting %s addresses",
    (count) => {
      setup()
      paste(
        Array.from(
          { length: count },
          (_, index) => `person${index}@example.com`,
        ).join(" "),
      )
      expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(
        20,
      )
      expect(screen.getByLabelText("Email addresses")).toBeDisabled()
      expect(screen.getAllByText(/20-person limit reached/)).toHaveLength(1)
      expect(
        screen.queryByText(
          "Paste a list or press Enter to add an address. Up to 20 people.",
        ),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText("You can invite up to 20 people at a time."),
      ).not.toBeInTheDocument()
      fireEvent.click(
        screen.getByRole("button", { name: "Remove person0@example.com" }),
      )
      expect(screen.getByLabelText("Email addresses")).toBeEnabled()
      expect(
        screen.queryByText(/20-person limit reached/),
      ).not.toBeInTheDocument()
      expect(
        screen.getByText(
          "Paste a list or press Enter to add an address. Up to 20 people.",
        ),
      ).toBeInTheDocument()
    },
  )
  it("resets when closed", () => {
    setup()
    paste("one@example.com")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(
      screen.queryByRole("button", { name: "Remove one@example.com" }),
    ).not.toBeInTheDocument()
  })
})
