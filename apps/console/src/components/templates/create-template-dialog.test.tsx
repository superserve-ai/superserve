import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cap: 0 as number | null,
  ready: true,
  teamKey: "use:team-a" as string | null,
  querySuccess: true,
  queryError: false,
  planState: "plan" as "plan" | "missing" | "legacy",
  refetch: vi.fn(),
  create: vi.fn(),
  push: vi.fn(),
}))
vi.mock("@/hooks/use-billing-v2", () => ({
  useTeamPlan: () => ({
    data:
      mocks.planState === "legacy"
        ? null
        : mocks.planState === "missing"
          ? undefined
          : { limits: { max_templates: mocks.cap } },
    isSuccess: mocks.querySuccess,
    isError: mocks.queryError,
    refetch: mocks.refetch,
  }),
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    ready: mocks.ready,
    teamKey: mocks.teamKey,
    cacheScope: "self",
  }),
}))
vi.mock("@/hooks/use-templates", () => ({
  useCreateTemplate: () => ({ mutateAsync: mocks.create }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }))
import { CreateTemplateDialog } from "./create-template-dialog"

beforeEach(() => {
  mocks.cap = 0
  mocks.ready = true
  mocks.teamKey = "use:team-a"
  mocks.querySuccess = true
  mocks.queryError = false
  mocks.planState = "plan"
  mocks.refetch.mockReset()
  mocks.create.mockReset()
})
describe("template creation entitlement", () => {
  it("replaces direct creation with an upgrade for a zero effective cap", () => {
    render(<CreateTemplateDialog />)
    expect(
      screen.getByRole("link", { name: "Upgrade to create templates" }),
    ).toHaveAttribute("href", "/plan-usage/upgrade")
    expect(screen.queryByRole("button", { name: "New template" })).toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("blocks a create deep-link and an already-open dialog when the cap becomes zero", () => {
    mocks.cap = 10
    const { rerender } = render(<CreateTemplateDialog open hideTrigger />)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    mocks.cap = 0
    rerender(<CreateTemplateDialog open hideTrigger />)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(
      screen.getByText("Your plan does not include template creation."),
    ).toBeInTheDocument()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each([10, null])(
    "preserves creation for paid or custom effective cap %s",
    (cap) => {
      mocks.cap = cap
      render(<CreateTemplateDialog />)
      expect(
        screen.getByRole("button", { name: "New template" }),
      ).toBeInTheDocument()
      expect(screen.queryByText("Upgrade to create templates")).toBeNull()
    },
  )
  it("keeps a closed triggerless dialog invisible", () => {
    const { container } = render(
      <CreateTemplateDialog hideTrigger open={false} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe("unknown template entitlement", () => {
  it("keeps initial deep-link and direct creation closed while limits load", () => {
    mocks.planState = "missing"
    mocks.querySuccess = false
    render(<CreateTemplateDialog open hideTrigger />)
    expect(screen.getByText("Loading template limits…")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("does not reopen Free creation after a failed refresh and offers retry", () => {
    const { rerender } = render(<CreateTemplateDialog open hideTrigger />)
    mocks.queryError = true
    mocks.querySuccess = false
    mocks.planState = "missing"
    rerender(<CreateTemplateDialog open hideTrigger />)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "Retry template limits" }),
    )
    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("ignores cached positive quota while the team is unresolved or switching", () => {
    mocks.cap = 10
    const { rerender } = render(<CreateTemplateDialog open hideTrigger />)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    mocks.ready = false
    rerender(<CreateTemplateDialog open hideTrigger />)
    expect(screen.queryByRole("dialog")).toBeNull()
    mocks.ready = true
    mocks.teamKey = null
    rerender(<CreateTemplateDialog open hideTrigger />)
    expect(screen.queryByRole("dialog")).toBeNull()
    mocks.teamKey = "use:team-b"
    mocks.planState = "missing"
    mocks.querySuccess = false
    rerender(<CreateTemplateDialog open hideTrigger />)
    expect(screen.queryByRole("dialog")).toBeNull()
    mocks.querySuccess = true
    mocks.planState = "plan"
    mocks.cap = null
    rerender(<CreateTemplateDialog open hideTrigger />)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("preserves a successful legacy plan:null without treating a failed query as legacy", () => {
    mocks.planState = "legacy"
    const { rerender } = render(<CreateTemplateDialog />)
    expect(
      screen.getByRole("button", { name: "New template" }),
    ).toBeInTheDocument()
    mocks.queryError = true
    mocks.querySuccess = false
    rerender(<CreateTemplateDialog />)
    expect(screen.queryByRole("button", { name: "New template" })).toBeNull()
  })
})

describe("current image validation with authoritative entitlement", () => {
  it.each(["alpine:latest", "gcr.io/distroless/base:latest"])(
    "preserves submission of configured image %s when templates are allowed",
    async (image) => {
      mocks.cap = 10
      mocks.create.mockResolvedValue({ id: "created-template" })
      render(<CreateTemplateDialog open hideTrigger />)
      fireEvent.change(screen.getByPlaceholderText("e.g. python-ml"), {
        target: { value: "allowed-template" },
      })
      fireEvent.click(screen.getByRole("button", { name: "Custom image…" }))
      fireEvent.change(screen.getByPlaceholderText("ghcr.io/myorg/base:v1"), {
        target: { value: image },
      })
      fireEvent.keyDown(screen.getByPlaceholderText("e.g. python-ml"), {
        key: "Enter",
      })
      await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "allowed-template",
          build_spec: { from: image },
        }),
      )
    },
  )
})
