import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
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
  useTeamEffectiveLimits: () => ({
    data:
      mocks.planState === "legacy"
        ? null
        : mocks.planState === "missing"
          ? undefined
          : {
              max_templates: mocks.cap,
              max_memory_mib: mocks.memoryCap,
              max_vcpu: mocks.vcpuCap,
              max_disk_mib: mocks.diskCap,
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
// Shiki loads grammars asynchronously; plain text is enough to assert snippets.
vi.mock("@superserve/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@superserve/ui")>()),
  HighlightedCode: ({ code }: { code: string }) => <pre>{code}</pre>,
}))
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
      fireEvent.change(screen.getByPlaceholderText("ghcr.io/example/base:v1"), {
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

  it("falls back to the default limits and says so when the plan reports no cap", () => {
    render(<CreateTemplateDialog open hideTrigger />)
    expect(spin("vCPU")).toHaveAttribute("aria-valuemax", "2")
    expect(spin("Memory")).toHaveAttribute("aria-valuemax", "4096")
    expect(spin("Disk")).toHaveAttribute("aria-valuemax", "8192")
    expect(
      screen.getByText(/No plan limit reported, so this is the default limit/),
    ).toBeInTheDocument()
  })

  it("keeps a team with no plan inside the default limits", async () => {
    // A team with no plan still has limits the backend enforces.
    mocks.planState = "legacy"
    render(<CreateTemplateDialog open hideTrigger />)
    press("Increase vCPU", 2)
    expect(spin("vCPU")).toHaveAttribute("aria-valuenow", "2")
    expect(screen.getByRole("button", { name: "Increase vCPU" })).toBeDisabled()
    fireEvent.keyDown(spin("Memory"), { key: "End" })
    fireEvent.keyDown(spin("Disk"), { key: "End" })
    expect(await submit()).toMatchObject({
      vcpu: 2,
      memory_mib: 4096,
      disk_mib: 8192,
    })
  })

  it("keeps a selection that a raised cap still allows", async () => {
    mocks.diskCap = 51200
    const view = render(<CreateTemplateDialog open hideTrigger />)
    fireEvent.keyDown(spin("Disk"), { key: "End" })
    mocks.diskCap = 102400
    view.rerender(<CreateTemplateDialog open hideTrigger />)
    expect(await submit()).toMatchObject({ disk_mib: 51200 })
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

const growthGroup = (resource: string) =>
  screen.getByRole("radiogroup", { name: resource })
const radio = (name: string | RegExp) =>
  within(growthGroup("Memory")).getByRole("radio", { name })
const cpuRadio = (name: string | RegExp) =>
  within(growthGroup("vCPU")).getByRole("radio", { name })
const section = (name: RegExp) => screen.getByRole("switch", { name })
const resize = () => fireEvent.click(section(/CPU and memory resizing/))
const sizeRange = () => fireEvent.click(section(/Size range/))

describe("memory growth", () => {
  beforeEach(() => {
    mocks.cap = 10
    mocks.memoryCap = 32768
    mocks.create.mockResolvedValue({ id: "created-template" })
  })

  it("is fixed by default and sends no ceiling", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    expect(growthGroup("Memory")).toBeInTheDocument()
    expect(radio("Fixed")).toBeChecked()
    expect(radio("Up to 4 GB")).not.toBeChecked()
    expect(screen.queryByRole("spinbutton", { name: "Max memory" })).toBeNull()
    expect(await submit()).not.toHaveProperty("memory_max_mib")
  })

  it("names the ceiling, 4x boot within the plan, and starts there", async () => {
    mocks.memoryCap = 3072
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    // 1 GB boot under a 3 GB cap: the cap wins over 4x.
    fireEvent.click(radio("Up to 3 GB"))
    expect(radio("Up to 3 GB")).toBeChecked()
    expect(spin("Max memory")).toHaveAttribute("aria-valuenow", "3072")
    expect(spin("Max memory")).toHaveAttribute("aria-valuemin", "2048")
    expect(spin("Max memory")).toHaveAttribute("aria-valuemax", "3072")
    // A lower ceiling is one step down, and the option follows it.
    press("Decrease Max memory")
    expect(radio("Up to 2 GB")).toBeChecked()
    expect(await submit()).toMatchObject({
      memory_mib: 1024,
      memory_max_mib: 2048,
    })
  })

  it("keeps the ceiling valid as boot memory changes", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    fireEvent.click(radio("Up to 4 GB"))
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

  it("goes back to fixed and drops the ceiling", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    fireEvent.click(radio("Up to 4 GB"))
    fireEvent.click(radio("Fixed"))
    expect(screen.queryByRole("spinbutton", { name: "Max memory" })).toBeNull()
    expect(await submit()).not.toHaveProperty("memory_max_mib")
  })

  it("turns off visibly when boot memory reaches the cap", async () => {
    mocks.memoryCap = 2048
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    fireEvent.click(radio("Up to 2 GB"))
    press("Increase Memory")
    expect(radio("At limit")).toBeDisabled()
    expect(radio("Fixed")).toBeChecked()
    expect(screen.queryByRole("spinbutton", { name: "Max memory" })).toBeNull()
    expect(growthGroup("Memory")).toHaveAccessibleDescription(
      "Growth needs at least 128 MB of room between memory and your limit. Lower memory to turn it on.",
    )
    // Room to grow again doesn't re-enable it without the user.
    press("Decrease Memory")
    expect(radio("Fixed")).toBeChecked()
    expect(await submit()).not.toHaveProperty("memory_max_mib")
  })

  it("clamps the ceiling when the plan limit drops while growth is on", async () => {
    const { rerender } = render(<CreateTemplateDialog open hideTrigger />)
    resize()
    press("Increase Memory")
    fireEvent.click(radio("Up to 8 GB"))
    expect(spin("Max memory")).toHaveAttribute("aria-valuenow", "8192")
    // A 6 GB limit is under 4x the 2 GB boot, so the limit is the new ceiling.
    mocks.memoryCap = 6144
    rerender(<CreateTemplateDialog open hideTrigger />)
    expect(radio("Up to 6 GB")).toBeChecked()
    expect(spin("Max memory")).toHaveAttribute("aria-valuenow", "6144")
    expect(spin("Max memory")).toHaveAttribute("aria-valuemax", "6144")
    mocks.memoryCap = 3072
    rerender(<CreateTemplateDialog open hideTrigger />)
    expect(radio("Up to 3 GB")).toBeChecked()
    expect(spin("Max memory")).toHaveAttribute("aria-valuenow", "3072")
    expect(spin("Memory")).toHaveAttribute("aria-valuenow", "2048")
    expect(await submit()).toMatchObject({
      memory_mib: 2048,
      memory_max_mib: 3072,
    })
  })

  it("shows the limit state when the plan limit drops to boot memory", async () => {
    const { rerender } = render(<CreateTemplateDialog open hideTrigger />)
    resize()
    press("Increase Memory", 2)
    fireEvent.click(radio("Up to 16 GB"))
    // The limit falls below the 4 GB boot size, so boot memory clamps to it
    // and there is no room left to grow.
    mocks.memoryCap = 2048
    rerender(<CreateTemplateDialog open hideTrigger />)
    expect(spin("Memory")).toHaveAttribute("aria-valuenow", "2048")
    expect(radio("At limit")).toBeDisabled()
    expect(radio("Fixed")).toBeChecked()
    expect(screen.queryByRole("spinbutton", { name: "Max memory" })).toBeNull()
    expect(growthGroup("Memory")).toHaveAccessibleDescription(
      "Growth needs at least 128 MB of room between memory and your limit. Lower memory to turn it on.",
    )
    // A raised limit doesn't turn growth back on without the user.
    mocks.memoryCap = 8192
    rerender(<CreateTemplateDialog open hideTrigger />)
    expect(radio("Fixed")).toBeChecked()
    expect(await submit()).not.toHaveProperty("memory_max_mib")
  })

  it("links to the live memory resizing docs", () => {
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    expect(
      screen.getByRole("link", { name: /Live memory resizing docs/ }),
    ).toHaveAttribute(
      "href",
      "https://docs.superserve.ai/sandbox/live-memory-resizing",
    )
  })

  it("sends shrink-after only with growth and within 60 to 1800 seconds", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    expect(screen.queryByLabelText("Shrink after (seconds)")).toBeNull()
    fireEvent.click(radio("Up to 4 GB"))
    const shrinkAfter = screen.getByLabelText("Shrink after (seconds)")
    fireEvent.change(shrinkAfter, { target: { value: "30" } })
    expect(
      screen.getByRole("button", { name: "Create & build" }),
    ).toBeDisabled()
    fireEvent.change(shrinkAfter, { target: { value: "300" } })
    expect(await submit()).toMatchObject({
      memory_max_mib: 4096,
      memory_shrink_after_seconds: 300,
    })
  })
})

describe("CPU growth", () => {
  beforeEach(() => {
    mocks.cap = 10
    mocks.vcpuCap = 32
    mocks.create.mockResolvedValue({ id: "created-template" })
  })

  it("is fixed by default and sends no ceiling", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    expect(cpuRadio("Fixed")).toBeChecked()
    expect(screen.queryByRole("spinbutton", { name: "Max vCPU" })).toBeNull()
    expect(await submit()).not.toHaveProperty("vcpu_max")
  })

  it("offers whole vCPUs up to 4x the count, within the plan", async () => {
    mocks.vcpuCap = 6
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    press("Increase vCPU")
    // 2 vCPU under a 6 vCPU cap: the cap wins over 4x.
    fireEvent.click(cpuRadio("Up to 6 vCPU"))
    expect(spin("Max vCPU")).toHaveAttribute("aria-valuenow", "6")
    expect(spin("Max vCPU")).toHaveAttribute("aria-valuemin", "3")
    expect(spin("Max vCPU")).toHaveAttribute("aria-valuemax", "6")
    press("Decrease Max vCPU")
    expect(cpuRadio("Up to 5 vCPU")).toBeChecked()
    expect(await submit()).toMatchObject({ vcpu: 2, vcpu_max: 5 })
  })

  it("turns off visibly when vCPU reaches the cap", async () => {
    mocks.vcpuCap = 2
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    fireEvent.click(cpuRadio("Up to 2 vCPU"))
    press("Increase vCPU")
    expect(cpuRadio("At limit")).toBeDisabled()
    expect(cpuRadio("Fixed")).toBeChecked()
    expect(growthGroup("vCPU")).toHaveAccessibleDescription(
      "Growth needs room between vCPU and your limit. Lower vCPU to turn it on.",
    )
    press("Decrease vCPU")
    expect(cpuRadio("Fixed")).toBeChecked()
    expect(await submit()).not.toHaveProperty("vcpu_max")
  })

  it("links to the live CPU resizing docs", () => {
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    expect(
      screen.getByRole("link", { name: /Live CPU resizing docs/ }),
    ).toHaveAttribute(
      "href",
      "https://docs.superserve.ai/sandbox/live-cpu-resizing",
    )
  })
})

describe("size range", () => {
  beforeEach(() => {
    mocks.cap = 10
    mocks.vcpuCap = 32
    mocks.memoryCap = 32768
    mocks.create.mockResolvedValue({ id: "created-template" })
  })

  it("is off by default and sends a fixed size", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    expect(section(/Size range/)).not.toBeChecked()
    expect(section(/CPU and memory resizing/)).not.toBeChecked()
    expect(screen.queryByRole("spinbutton", { name: "vCPU up to" })).toBeNull()
    expect(screen.getByText(/^1 vCPU · 1 GB · 4 GB disk$/)).toBeInTheDocument()
    const sent = await submit()
    expect(sent).not.toHaveProperty("vcpu_max")
    expect(sent).not.toHaveProperty("memory_max_mib")
  })

  it("opens at the widest range and sends the same fields as resizing", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    sizeRange()
    expect(spin("vCPU up to")).toHaveAttribute("aria-valuenow", "4")
    expect(spin("Memory up to")).toHaveAttribute("aria-valuenow", "4096")
    expect(
      screen.getByText(/^1–4 vCPU · 1–4 GB · 4 GB disk$/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Sandboxes that don't choose a size grow with load up to this limit.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Custom size docs" }),
    ).toHaveAttribute("href", "https://docs.superserve.ai/sandbox/size")
    expect(await submit()).toEqual({
      name: "sized-template",
      vcpu: 1,
      vcpu_max: 4,
      memory_mib: 1024,
      memory_max_mib: 4096,
      disk_mib: 4096,
      build_spec: { from: "python:3.12-slim" },
    })
  })

  it("drops one resource's range when its limit steps down to the Size", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    sizeRange()
    fireEvent.keyDown(spin("Memory up to"), { key: "Home" })
    expect(spin("Memory up to")).toHaveAttribute("aria-valuenow", "1024")
    const sent = await submit()
    expect(sent).toMatchObject({ vcpu_max: 4 })
    expect(sent).not.toHaveProperty("memory_max_mib")
  })

  it("shares one limit with resizing", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    sizeRange()
    resize()
    expect(
      screen.getByText(
        "Size range and resizing share the vCPU and memory limits.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/grow with load up to this limit/)).toBeNull()
    expect(cpuRadio("Up to 4 vCPU")).toBeChecked()
    press("Decrease Max vCPU")
    expect(spin("vCPU up to")).toHaveAttribute("aria-valuenow", "3")
    // Turning Size range off keeps the limit resizing still uses.
    sizeRange()
    expect(await submit()).toMatchObject({ vcpu_max: 3, memory_max_mib: 4096 })
  })

  it("clears the limits when the last section turns off", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    sizeRange()
    sizeRange()
    const sent = await submit()
    expect(sent).not.toHaveProperty("vcpu_max")
    expect(sent).not.toHaveProperty("memory_max_mib")
  })

  it("sends shrink-after only while resizing is on", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    sizeRange()
    expect(screen.queryByLabelText("Shrink after (seconds)")).toBeNull()
    resize()
    fireEvent.change(screen.getByLabelText("Shrink after (seconds)"), {
      target: { value: "300" },
    })
    resize()
    expect(await submit()).not.toHaveProperty("memory_shrink_after_seconds")
  })
})

describe("view as code", () => {
  beforeEach(() => {
    mocks.cap = 10
    mocks.create.mockResolvedValue({ id: "created-template" })
  })

  const toggle = () => screen.getByRole("button", { name: "View as code" })

  it("is collapsed by default and controls a hidden section", () => {
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    expect(toggle()).toHaveAttribute("aria-expanded", "false")
    const section = document.getElementById(
      toggle().getAttribute("aria-controls") ?? "",
    )
    expect(section).not.toBeNull()
    expect(section).not.toBeVisible()
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute("aria-expanded", "true")
    expect(section).toBeVisible()
    expect(screen.getByRole("region", { name: "This template as code" })).toBe(
      section,
    )
  })

  it("shows the CLI command for the shape being built, live", () => {
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    fireEvent.change(screen.getByPlaceholderText("e.g. python-ml"), {
      target: { value: "python-ml" },
    })
    fireEvent.click(toggle())
    const code = () =>
      screen.getByRole("tabpanel").querySelector("pre")?.textContent
    expect(code()).toContain("superserve template create python-ml")
    expect(code()).toContain("--from python:3.12-slim")
    expect(code()).not.toContain("--memory-max")
    fireEvent.click(radio("Up to 4 GB"))
    expect(code()).toContain("--memory-max 4G")
  })

  it("switches to the SDK snippets", () => {
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    fireEvent.click(toggle())
    fireEvent.click(screen.getByRole("tab", { name: "Python" }))
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Template.create(")
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      'from_="python:3.12-slim"',
    )
  })

  it("copies the snippet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    fireEvent.click(toggle())
    fireEvent.click(screen.getByRole("button", { name: "Copy CLI code" }))
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Copied" }),
      ).toBeInTheDocument(),
    )
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("superserve template create"),
    )
  })

  it("submits the same shape the code shows", async () => {
    render(<CreateTemplateDialog open hideTrigger />)
    resize()
    fireEvent.click(radio("Up to 4 GB"))
    expect(await submit()).toEqual({
      name: "sized-template",
      vcpu: 1,
      memory_mib: 1024,
      memory_max_mib: 4096,
      disk_mib: 4096,
      build_spec: { from: "python:3.12-slim" },
    })
  })
})
