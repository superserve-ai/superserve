import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  autoJoin: vi.fn(),
  join: vi.fn(),
  signOut: vi.fn(),
  reset: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ reset: mocks.reset }),
}))
vi.mock("./actions", () => ({
  autoJoinInviteAction: mocks.autoJoin,
  joinInviteAction: mocks.join,
  signOutForInviteAction: mocks.signOut,
}))

import { AutoJoin, MismatchControls } from "./invite-controls"

beforeEach(() => {
  vi.resetAllMocks()
})

describe("AutoJoin", () => {
  it("retries a failed automatic acceptance through the explicit join action", async () => {
    const token = `ssinv_use_${"T".repeat(43)}`
    mocks.autoJoin.mockResolvedValue({ status: "error", code: "failed" })
    mocks.join.mockResolvedValue({ status: "redirect", to: "/sandboxes" })

    render(<AutoJoin token={token} />)

    expect(await screen.findByRole("alert")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Join team" }))

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/sandboxes"),
    )
    expect(mocks.join).toHaveBeenCalledWith(token)
    expect(mocks.autoJoin).toHaveBeenCalledTimes(1)
    expect(mocks.autoJoin).toHaveBeenCalledWith(token)
  })

  it("offers Join when the server sends it back to the page", async () => {
    const token = `ssinv_use_${"T".repeat(43)}`
    mocks.autoJoin.mockResolvedValue({ status: "reload" })
    mocks.join.mockResolvedValue({ status: "redirect", to: "/sandboxes" })

    render(<AutoJoin token={token} />)

    fireEvent.click(await screen.findByRole("button", { name: "Join team" }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alert")).toBeNull()
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/sandboxes"),
    )
    expect(mocks.autoJoin).toHaveBeenCalledTimes(1)
  })
})

describe("MismatchControls", () => {
  it("clears the previous account's browser state after signing out", async () => {
    const token = `ssinv_use_${"T".repeat(43)}`
    localStorage.setItem(
      "superserve.terminal-tabs",
      JSON.stringify([{ id: "tab-1", name: "previous" }]),
    )
    mocks.signOut.mockResolvedValue({ status: "redirect", to: "/auth/signin" })

    render(<MismatchControls token={token} />)
    fireEvent.click(screen.getByRole("button"))

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/auth/signin"),
    )
    expect(mocks.reset).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem("superserve.terminal-tabs")).toBeNull()
  })
})
