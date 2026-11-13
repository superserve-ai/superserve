import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { RevokeKeyDialog } from "./revoke-key-dialog"

describe("RevokeKeyDialog", () => {
  it("shows an accessible small spinner until revocation finishes", async () => {
    let finish!: () => void
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const onOpenChange = vi.fn()
    render(
      <RevokeKeyDialog
        open
        keyName="production"
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "production" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole("button", { name: "Loading Revoke" }),
    ).toBeDisabled()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
    const spinner = screen.getByRole("status", { name: "Loading" })
    expect(spinner).toHaveClass("h-4 w-4 border-current border-t-transparent")
    for (const className of ["h-5", "w-5", "border-white"]) {
      expect(spinner).not.toHaveClass(className)
    }

    await act(async () => finish())
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByRole("status")).toBeNull()
  })
})
