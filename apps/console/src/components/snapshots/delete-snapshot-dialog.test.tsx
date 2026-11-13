import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { SnapshotResponse } from "@/lib/api/types"

vi.mock("@/hooks/use-snapshots", () => ({
  useDeleteSnapshot: () => ({ isPending: true, mutate: vi.fn() }),
}))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}))

import { DeleteSnapshotDialog } from "./delete-snapshot-dialog"

const snapshot: SnapshotResponse = {
  id: "snap-1",
  sandbox_id: "sbx-1",
  template_id: null,
  kind: "mem+fs",
  status: "ready",
  name: "checkpoint",
  size_bytes: 1024,
  resources: { vcpu_count: 1, memory_mib: 1024, disk_mib: 1024 },
  created_at: "2026-11-01T00:00:00Z",
  ready_at: "2026-11-01T00:00:01Z",
}

describe("DeleteSnapshotDialog", () => {
  it("shows an accessible small spinner and disables actions while deleting", () => {
    render(
      <DeleteSnapshotDialog snapshot={snapshot} open onOpenChange={vi.fn()} />,
    )

    expect(
      screen.getByRole("button", { name: "Loading Delete" }),
    ).toBeDisabled()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
    const spinner = screen.getByRole("status", { name: "Loading" })
    expect(spinner).toHaveClass("h-4 w-4 border-current border-t-transparent")
    for (const className of ["h-5", "w-5", "border-white"]) {
      expect(spinner).not.toHaveClass(className)
    }
  })
})
