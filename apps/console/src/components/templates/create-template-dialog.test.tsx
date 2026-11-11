import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cap: 0 as number | null,
  memoryCap: null as number | null,
  vcpuCap: null as number | null,
  diskCap: null as number | null,
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
          : {
              limits: {
                max_templates: mocks.cap,
                max_memory_mib: mocks.memoryCap,
                max_vcpu: mocks.vcpuCap,
                max_disk_mib: mocks.diskCap,
              },
            },
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
  mocks.memoryCap = null
  mocks.vcpuCap = null
  mocks.diskCap = null
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
    ).toHaveAttribute("href", "/billing-usage/upgrade")
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

const spin = (name: string) => screen.getByRole("spinbutton", { name })
const press = (name: string, times = 1) => {
  for (let i = 0; i < times; i++)
    fireEvent.click(screen.getByRole("button", { name }))
}
async function submit() {
  fireEvent.change(screen.getByPlaceholderText("e.g. python-ml"), {
    target: { value: "sized-template" },
  })
  fireEvent.keyDown(screen.getByPlaceholderText("e.g. python-ml"), {
    key: "Enter",
  })
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
  return mocks.create.mock.calls[0][0]
}

describe("resource ranges follow the team's plan caps", () => {
  beforeEach(() => {
    mocks.cap = 10
    mocks.create.mockResolvedValue({ id: "created-template" })
  })

  it("reaches a raised cap, including one that isn't a power of two", async () => {
    mocks.vcpuCap = 6
    mocks.memoryCap = 12288
    mocks.diskCap = 20480
    render(<CreateTemplateDialog open hideTrigger />)
    expect(spin("vCPU")).toHaveAttribute("aria-valuemax", "6")
    expect(spin("Memory")).toHaveAttribute("aria-valuemax", "12288")
    fireEvent.keyDown(spin("vCPU"), { key: "End" })
    fireEvent.keyDown(spin("Memory"), { key: "End" })
    fireEvent.keyDown(spin("Disk"), { key: "End" })
    expect(
      screen.getByRole("button", { name: "Increase Memory" }),
    ).toBeDisabled()
    expect(await submit()).toMatchObject({
      vcpu: 6,
      memory_mib: 12288,
      disk_mib: 20480,
    })
  })

  it("falls back to the API maximum and says so when the plan reports no cap", () => {
    render(<CreateTemplateDialog open hideTrigger />)
    expect(spin("vCPU")).toHaveAttribute("aria-valuemax", "32")
    expect(spin("Memory")).toHaveAttribute("aria-valuemax", "131072")
    expect(
      screen.getByText("No plan limit reported · API maximum 32 vCPU"),
    ).toBeInTheDocument()
  })

  it("clamps a selection the shrinking cap no longer allows", async () => {
    const view = render(<CreateTemplateDialog open hideTrigger />)
    press("Increase Memory", 2)
    expect(spin("Memory")).toHaveAttribute("aria-valuenow", "4096")
    mocks.memoryCap = 2048
    view.rerender(<CreateTemplateDialog open hideTrigger />)
    expect(spin("Memory")).toHaveAttribute("aria-valuenow", "2048")
    expect(await submit()).toMatchObject({ memory_mib: 2048 })
  })
})

describe("memory growth", () => {
  beforeEach(() => {
    mocks.cap = 10
    mocks.create.mockResolvedValue({ id: "created-template" })
  })

  it("is fixed by default and sends no ceiling", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    expect(screen.getByRole("switch")).not.toBeChecked()
    expect(screen.queryByRole("spinbutton", { name: "Max memory" })).toBeNull()
    expect(await submit()).not.toHaveProperty("memory_max_mib")
  })

  it("offers ceilings above boot memory, up to 4x and within the cap", async () => {
    mocks.memoryCap = 3072
    render(<CreateTemplateDialog open hideTrigger />)
    fireEvent.click(screen.getByRole("switch"))
    // 1 GB boot under a 3 GB cap: 2 GB, then the cap itself.
    expect(spin("Max memory")).toHaveAttribute("aria-valuemin", "2048")
    expect(spin("Max memory")).toHaveAttribute("aria-valuemax", "3072")
    fireEvent.keyDown(spin("Max memory"), { key: "End" })
    expect(await submit()).toMatchObject({
      memory_mib: 1024,
      memory_max_mib: 3072,
    })
  })

  it("keeps the ceiling valid as boot memory changes", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    fireEvent.click(screen.getByRole("switch"))
    fireEvent.keyDown(spin("Max memory"), { key: "End" })
    expect(spin("Max memory")).toHaveAttribute("aria-valuenow", "4096")
    // Dropping to 512 MB pulls the ceiling down to 4x, 2 GB.
    press("Decrease Memory")
    expect(spin("Max memory")).toHaveAttribute("aria-valuenow", "2048")
    // Raising to 4 GB pushes it above boot memory.
    press("Increase Memory", 3)
    expect(spin("Max memory")).toHaveAttribute("aria-valuenow", "8192")
    expect(await submit()).toMatchObject({
      memory_mib: 4096,
      memory_max_mib: 8192,
    })
  })

  it("turns off visibly when boot memory reaches the cap", async () => {
    mocks.memoryCap = 2048
    render(<CreateTemplateDialog open hideTrigger />)
    fireEvent.click(screen.getByRole("switch"))
    press("Increase Memory")
    expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("switch")).not.toBeChecked()
    expect(
      screen.getByText(
        "Boot memory is at your plan's limit, so there is no room to grow.",
      ),
    ).toBeInTheDocument()
    // Room to grow again doesn't re-enable it without the user.
    press("Decrease Memory")
    expect(screen.getByRole("switch")).not.toBeChecked()
    expect(await submit()).not.toHaveProperty("memory_max_mib")
  })
})
