import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  refresh: vi.fn(),
  displayed: vi.fn(),
}))
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
  mocks.create.mockResolvedValue({ ok: true, delivery: "sent" })
})

describe("InviteMembersDialog", () => {
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
    fireEvent.change(screen.getByLabelText("Email for one@example.com"), {
      target: { value: "other@example.c" },
    })
    const input = screen.getByLabelText("Email for other@example.c")
    expect(input).toBeInTheDocument()
    fireEvent.change(input, { target: { value: "other@example.com" } })
    fireEvent.blur(input)
    expect(screen.getByText("other@example.com")).toHaveAttribute("data-mask")
  })

  it("defaults new rows to Team admin with allowed known options in display order", () => {
    setup()
    paste("one@example.com two@example.com")
    const select = screen.getByRole("combobox", {
      name: "Role for one@example.com",
    })
    expect(select).toHaveValue("team_admin")
    expect(screen.getByLabelText("Role for two@example.com")).toHaveValue(
      "team_admin",
    )
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Team admin", "User admin", "Billing admin", "Viewer", "Owner"])
    expect(
      screen.getAllByText(
        "Create sandboxes and API keys, manage members and settings.",
      ),
    ).toHaveLength(2)
  })
  it("summarizes sent invitations and rows needing attention", async () => {
    mocks.create
      .mockResolvedValueOnce({ delivery: "sent" })
      .mockRejectedValueOnce({ code: "already_member" })
    setup()
    paste("one@example.com two@example.com")
    send()
    expect(
      await screen.findByText("1 sent. 1 needs attention."),
    ).toBeInTheDocument()
  })
  it.each([
    [["team_owner", "billing_admin", "user_admin", "viewer"], "viewer"],
    [["team_owner", "billing_admin", "user_admin"], "billing_admin"],
    [["team_owner", "user_admin"], "user_admin"],
    [["team_owner", "team_admin"], "team_admin"],
  ])("uses the preferred available role in %j", (roles, expected) => {
    setup(roles)
    paste("one@example.com")
    expect(screen.getByRole("combobox")).toHaveValue(expected)
    expect(screen.getAllByRole("option")).toHaveLength(roles.length)
  })
  it("requires choosing Owner deliberately when it is the only role", () => {
    setup(["team_owner"])
    paste("one@example.com")
    const select = screen.getByRole("combobox")
    expect(select).toHaveValue("")
    expect(screen.getByRole("option", { name: "Choose role" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Send invites" })).toBeDisabled()
    fireEvent.change(select, { target: { value: "team_owner" } })
    expect(screen.getByRole("button", { name: "Send invites" })).toBeEnabled()
    expect(
      screen.queryByRole("option", { name: "Choose role" }),
    ).not.toBeInTheDocument()
  })
  it("blocks sending with no known allowed roles", () => {
    setup(["future_role"])
    paste("one@example.com")
    expect(screen.getByRole("button", { name: "Send invites" })).toBeDisabled()
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
  it("sends sequentially, locks controls, keeps results, refreshes after the loop and retries failures", async () => {
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
    expect(screen.getByText("Already a member")).toBeInTheDocument()
    expect(mocks.create).toHaveBeenCalledTimes(3)
    expect(mocks.create.mock.calls[0][0]).toEqual({
      team,
      email: "one@example.com",
      role: "team_admin",
    })
    fireEvent.change(screen.getByLabelText("Email for three@example.com"), {
      target: { value: "fixed@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Retry failed" }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(4))
    expect(mocks.create.mock.calls[3][0].email).toBe("fixed@example.com")
    expect(screen.getAllByText("Sent")).toHaveLength(2)
  })
  it.each([
    ["invitation_pending", "Already invited"],
    ["invalid_role", "Role not allowed"],
    ["rate_limited", "Too many invites sent. Try again later."],
    ["bad_request", "Invalid email"],
    ["pending_limit", "Too many pending invites"],
    ["free_plan", "Upgrade to invite members"],
    ["unavailable", "Something went wrong. Please try again."],
  ])("maps %s and retries", async (code, message) => {
    mocks.create.mockRejectedValueOnce({ code })
    setup()
    paste("one@example.com")
    send()
    expect(await screen.findByText(message)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry failed" }))
    expect(await screen.findByText("Sent")).toBeInTheDocument()
    expect(mocks.create).toHaveBeenCalledTimes(2)
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
  })
  it("caps rows at 20", () => {
    setup()
    paste(
      Array.from(
        { length: 22 },
        (_, index) => `person${index}@example.com`,
      ).join(" "),
    )
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(20)
    expect(screen.getByLabelText("Email addresses")).toBeDisabled()
    expect(screen.getByText(/20-person limit reached/)).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Remove person0@example.com" }),
    )
    expect(screen.getByLabelText("Email addresses")).toBeEnabled()
  })
  it("resets when closed", () => {
    setup()
    paste("one@example.com")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(
      screen.queryByRole("button", { name: "Remove one@example.com" }),
    ).not.toBeInTheDocument()
  })
})
