import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"
import { snapshotKeys } from "@/lib/api/query-keys"
import { createQueryWrapper } from "@/test/react-query"

const mockCreate = vi.fn()

vi.mock("@/lib/api/snapshots", () => ({
  createSnapshot: (...a: unknown[]) => mockCreate(...a),
  deleteSnapshot: vi.fn(),
  listSandboxSnapshots: vi.fn(),
  renameSnapshot: vi.fn(),
}))
vi.mock("@/lib/api/snapshots-actions", () => ({
  listSnapshotsAction: vi.fn(),
}))

const mockAddToast = vi.fn()
vi.mock("@superserve/ui", () => ({
  useToast: () => ({ addToast: mockAddToast }),
}))

import { STILL_TAKING_MESSAGE, useCreateSnapshot } from "./use-snapshots"

async function takeSnapshot() {
  const { wrapper, queryClient } = createQueryWrapper()
  const invalidate = vi.spyOn(queryClient, "invalidateQueries")
  const { result } = renderHook(() => useCreateSnapshot(), { wrapper })
  await act(async () => {
    await result.current.mutateAsync({ sandboxId: "sbx-1" }).catch(() => {})
  })
  return { invalidate }
}

describe("useCreateSnapshot", () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockAddToast.mockReset()
  })

  it.each([
    ["a request timeout", new DOMException("aborted", "AbortError")],
    ["a dropped connection", new TypeError("Failed to fetch")],
    ["a gateway timeout", new ApiError(504, "unknown_error", "Gateway")],
  ])("reports %s as still being taken and refetches", async (_, error) => {
    mockCreate.mockRejectedValue(error)
    const { invalidate } = await takeSnapshot()

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(STILL_TAKING_MESSAGE, "info")
    })
    expect(mockAddToast).not.toHaveBeenCalledWith(expect.anything(), "error")
    expect(invalidate).toHaveBeenCalledWith({ queryKey: snapshotKeys.all })
  })

  it.each([
    [409, "conflict", "sandbox must be active or paused to snapshot"],
    [429, "too_many_snapshots", "team or sandbox has reached its limit"],
    [503, "host_not_ready", "the sandbox's host cannot take snapshots yet"],
  ])("shows the API message for a %i", async (status, code, message) => {
    mockCreate.mockRejectedValue(new ApiError(status, code, message))
    await takeSnapshot()

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(message, "error")
    })
  })

  it("reports a 202 (still creating) as still being taken", async () => {
    mockCreate.mockResolvedValue({ id: "snap-1", status: "creating" })
    await takeSnapshot()

    expect(mockAddToast).toHaveBeenCalledWith(STILL_TAKING_MESSAGE, "info")
  })

  it("confirms a ready snapshot", async () => {
    mockCreate.mockResolvedValue({ id: "snap-1", status: "ready" })
    await takeSnapshot()

    expect(mockAddToast).toHaveBeenCalledWith("Snapshot saved", "success")
  })
})
