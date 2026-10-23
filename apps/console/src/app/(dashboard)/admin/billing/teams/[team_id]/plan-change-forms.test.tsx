import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import {
  assignTeamPlanAction,
  requestPlanChangeAction,
  undoPlanChangeAction,
} from "./actions"
import {
  AssignPlanForm,
  PlanChangeForm,
  UndoPlanChangeForm,
} from "./plan-change-forms"

vi.mock("./actions", () => ({
  requestPlanChangeAction: vi.fn(),
  undoPlanChangeAction: vi.fn(),
  assignTeamPlanAction: vi.fn(),
}))

const team = "22222222-2222-4222-8222-222222222222"
const options = [
  { target: "free" as const, label: "Free" },
  { target: "starter" as const, label: "Starter" },
]
const freeLimits = {
  max_concurrent: 1,
  max_vcpu: 1,
  max_memory_mib: 1024,
  max_disk_mib: 4096,
  max_templates: null,
}
const enterprise = {
  id: "44444444-4444-4444-8444-444444444444",
  family: "enterprise_example",
  version: 2,
  state: "published",
  kind: "custom",
  display_name: "Enterprise",
  limits: { max_concurrent: 5000, max_vcpu: 16 },
}

beforeEach(() => {
  vi.mocked(requestPlanChangeAction).mockReset()
  vi.mocked(undoPlanChangeAction).mockReset()
  vi.mocked(assignTeamPlanAction).mockReset()
})

function renderChange() {
  render(
    <PlanChangeForm
      region="use"
      teamId={team}
      options={options}
      freeLimits={freeLimits}
    />,
  )
}

function choose(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

it("retries a lost plan change with the same idempotency key", async () => {
  vi.mocked(requestPlanChangeAction)
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce({ kind: "unavailable" })
    .mockResolvedValueOnce({ kind: "saved" })
  renderChange()
  choose(/Move to/, "starter")
  choose(/Reason/, "Customer asked")
  fireEvent.click(screen.getByRole("button", { name: "Request change" }))
  await screen.findByText(/Retry to send the same request/)
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await waitFor(() => expect(requestPlanChangeAction).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await screen.findByText("Plan change requested.")
  const calls = vi.mocked(requestPlanChangeAction).mock.calls
  expect(new Set(calls.map(([input]) => input.idempotencyKey)).size).toBe(1)
  expect(calls[0][0]).toMatchObject({
    region: "use",
    teamId: team,
    targetPlan: "starter",
    reason: "Customer asked",
  })
})

it("sends a new request once the input changes", async () => {
  vi.mocked(requestPlanChangeAction).mockResolvedValue({ kind: "unavailable" })
  renderChange()
  choose(/Move to/, "starter")
  choose(/Reason/, "Customer asked")
  fireEvent.click(screen.getByRole("button", { name: "Request change" }))
  await screen.findByText(/Retry to send the same request/)
  choose(/Reason/, "Customer asked by email")
  fireEvent.click(screen.getByRole("button", { name: "Request change" }))
  await waitFor(() => expect(requestPlanChangeAction).toHaveBeenCalledTimes(2))
  const keys = vi
    .mocked(requestPlanChangeAction)
    .mock.calls.map(([input]) => input.idempotencyKey)
  expect(keys[0]).not.toBe(keys[1])
})

it("warns that a move to Free pauses running compute", () => {
  renderChange()
  choose(/Move to/, "starter")
  expect(screen.queryByText(/will be paused/)).toBeNull()
  choose(/Move to/, "free")
  expect(screen.getByText(/All running compute will be paused/)).toBeTruthy()
  expect(
    screen.getByText("1 running at once · 1 vCPU · 1 GiB RAM · 4 GiB disk"),
  ).toBeTruthy()
})

it("undoes the pending change with a reason", async () => {
  vi.mocked(undoPlanChangeAction).mockResolvedValue({ kind: "saved" })
  render(
    <UndoPlanChangeForm
      region="use"
      teamId={team}
      changeId="33333333-3333-4333-8333-333333333333"
    />,
  )
  choose(/Undo reason/, "Customer changed their mind")
  fireEvent.click(screen.getByRole("button", { name: "Undo change" }))
  await screen.findByText("Plan change undone.")
  expect(undoPlanChangeAction).toHaveBeenCalledWith({
    region: "use",
    teamId: team,
    changeId: "33333333-3333-4333-8333-333333333333",
    reason: "Customer changed their mind",
  })
})

it("assigns a custom plan version and shows the backend's refusal", async () => {
  vi.mocked(assignTeamPlanAction).mockResolvedValue({
    kind: "conflict",
    detail: "this plan version is retired",
  })
  render(<AssignPlanForm region="use" teamId={team} plans={[enterprise]} />)
  choose(/Plan/, enterprise.id)
  choose(/Reason/, "Signed Enterprise agreement")
  fireEvent.click(screen.getByRole("button", { name: "Assign plan" }))
  await screen.findByText("Reason: this plan version is retired")
  expect(vi.mocked(assignTeamPlanAction).mock.calls[0][0]).toMatchObject({
    region: "use",
    teamId: team,
    versionId: enterprise.id,
    reason: "Signed Enterprise agreement",
  })
})

it("explains when no custom plan can be assigned", () => {
  render(<AssignPlanForm region="use" teamId={team} plans={[]} />)
  expect(screen.getByText(/No custom plan is published/)).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Assign plan" })).toBeNull()
})
