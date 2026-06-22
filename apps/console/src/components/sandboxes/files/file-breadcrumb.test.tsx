import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@phosphor-icons/react", () => {
  const Icon = () => <span />
  return { CaretRightIcon: Icon, HouseIcon: Icon }
})

import { FileBreadcrumb } from "./file-breadcrumb"

describe("FileBreadcrumb", () => {
  // Regression: the home icon used to navigate to "/", which boxd's safePath
  // refuses to list ("cannot operate on root directory"), surfacing as
  // "Path is not a listable directory". It must target the sandbox home.
  it("home icon navigates to homePath, never the unlistable root", async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(
      <FileBreadcrumb
        path="/home/user/proj"
        homePath="/home/user"
        onNavigate={onNavigate}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Home" }))

    expect(onNavigate).toHaveBeenCalledWith("/home/user")
    expect(onNavigate).not.toHaveBeenCalledWith("/")
  })

  it("a middle segment navigates to its cumulative path; the current dir is disabled", async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(
      <FileBreadcrumb
        path="/home/user/proj"
        homePath="/home/user"
        onNavigate={onNavigate}
      />,
    )

    await user.click(screen.getByRole("button", { name: "user" }))
    expect(onNavigate).toHaveBeenCalledWith("/home/user")
    expect(screen.getByRole("button", { name: "proj" })).toBeDisabled()
  })
})
