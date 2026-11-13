import { ToastProvider } from "@superserve/ui"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { beforeEach, expect, it, vi } from "vitest"

import {
  ConnectSandboxDialog,
  getConnectSnippet,
  LANGUAGES,
} from "./connect-sandbox-dialog"

const { keyState, mutation, push } = vi.hoisted(() => ({
  keyState: {
    data: [] as { name: string }[] | undefined,
    isPending: false,
  },
  mutation: {
    data: undefined as { key: string } | undefined,
    isPending: false,
    mutate: vi.fn(),
  },
  push: vi.fn(),
}))

vi.mock("@/hooks/use-api-keys", () => ({
  useApiKeys: () => keyState,
  useCreateApiKey: () => mutation,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  keyState.data = []
  keyState.isPending = false
  mutation.data = undefined
  mutation.isPending = false
})

function renderDialog(sandboxId = "sbx-42") {
  return render(
    <ToastProvider>
      <ConnectSandboxDialog sandboxId={sandboxId} open onOpenChange={vi.fn()} />
    </ToastProvider>,
  )
}

it("prioritizes creating a key and hides the run snippet until a key exists", async () => {
  const user = userEvent.setup()
  renderDialog()

  expect(
    screen.getByRole("dialog", { name: "Connect to this sandbox from code" }),
  ).toBeInTheDocument()
  expect(screen.getByText("1. Create an API key")).toBeInTheDocument()
  expect(screen.getByText("2. Install the SDK")).toBeInTheDocument()
  expect(screen.getByText("3. Run this code")).toBeInTheDocument()
  expect(
    screen.getByText(
      "Your code uses an API key to create, pause, and resume sandboxes. The key shows one time only. Copy it when it appears.",
    ),
  ).toBeInTheDocument()
  expect(
    screen.getByText("Create an API key in step 1 to see this code."),
  ).toBeInTheDocument()
  expect(
    screen.queryByText(/Use one of your API keys\./),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("link", { name: "API keys page" }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole("dialog")).not.toHaveTextContent("Sandbox.connect(")
  expect(screen.getByRole("dialog")).not.toHaveTextContent("ss_live_xxxxxxxx")
  expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(1)
  expect(screen.getByRole("button", { name: "Done" })).not.toHaveClass(
    "bg-primary",
  )
  expect(screen.getByRole("button", { name: "Done" })).toHaveClass(
    "border-dashed",
  )

  const createButton = screen.getByRole("button", { name: "Create API key" })
  expect(createButton).toHaveClass("bg-primary")
  await user.click(createButton)
  expect(mutation.mutate).toHaveBeenCalledExactlyOnceWith("SDK Key")
})

it("disables the create button while loading keys without changing the steps", async () => {
  const user = userEvent.setup()
  keyState.data = undefined
  keyState.isPending = true
  renderDialog()

  expect(screen.getByText("1. Create an API key")).toBeInTheDocument()
  expect(screen.getByText("2. Install the SDK")).toBeInTheDocument()
  expect(screen.getByText("3. Run this code")).toBeInTheDocument()
  const createButton = screen.getByRole("button", { name: "Create API key" })
  expect(createButton).toBeDisabled()
  await user.click(createButton)
  expect(mutation.mutate).not.toHaveBeenCalled()
})

it("enables the create button when loading keys fails without data", () => {
  keyState.data = undefined
  keyState.isPending = false
  renderDialog()

  expect(screen.getByRole("button", { name: "Create API key" })).toBeEnabled()
})

it("disables the create button while creating a key", () => {
  mutation.isPending = true
  renderDialog()

  expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled()
})

it("shows the newly created key only in the copy-key field", () => {
  const key = "ss_live_newly_created"
  keyState.data = [{ name: "SDK Key" }]
  mutation.data = { key }
  renderDialog()

  expect(screen.getByText("1. Copy your API key")).toBeInTheDocument()
  expect(screen.getByText("2. Install the SDK")).toBeInTheDocument()
  expect(screen.getByText("3. Run this code")).toBeInTheDocument()
  expect(screen.getByText(key, { selector: "code" })).toBeInTheDocument()
  expect(
    screen.getByRole("button", { name: "Copy API key" }),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      "Copy this API key now. You cannot see it again after you close this dialog.",
    ),
  ).toBeInTheDocument()
  expect(
    screen.queryByText(/Use one of your API keys\./),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("link", { name: "API keys page" }),
  ).not.toBeInTheDocument()
  const dialog = screen.getByRole("dialog")
  expect(dialog).toHaveTextContent('Sandbox.connect("sbx-42")')
  const runSnippet = screen.getByText(/Sandbox\.connect\("sbx-42"\)/, {
    selector: "code",
  })
  expect(runSnippet).toHaveTextContent("export SUPERSERVE_API_KEY=ss_live_...")
  expect(runSnippet).not.toHaveTextContent(key)
  expect(dialog.textContent?.split(key)).toHaveLength(2)
  expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(2)
  expect(screen.getByRole("button", { name: "Done" })).toHaveClass("bg-primary")
})

it("focuses the copy-key button after creating an API key", async () => {
  const user = userEvent.setup()
  const { rerender } = renderDialog()

  const createButton = screen.getByRole("button", { name: "Create API key" })
  await user.click(createButton)
  expect(mutation.mutate).toHaveBeenCalledExactlyOnceWith("SDK Key")
  expect(document.activeElement).toBe(createButton)

  mutation.data = { key: "ss_live_newly_created" }
  rerender(
    <ToastProvider>
      <ConnectSandboxDialog sandboxId="sbx-42" open onOpenChange={vi.fn()} />
    </ToastProvider>,
  )

  await waitFor(() => {
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Copy API key" }),
    )
  })
  expect(screen.getByRole("button", { name: "Copy API key" })).toHaveClass(
    "focus-visible:outline-none",
    "focus-visible:ring-2",
    "focus-visible:ring-border-focus",
  )
})

it("shows two steps and the run snippet when the team already has a key", () => {
  keyState.data = [{ name: "Existing key" }]
  renderDialog()

  expect(screen.getByText("1. Install the SDK")).toBeInTheDocument()
  expect(screen.getByText("2. Run this code")).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Create API key" }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole("dialog")).not.toHaveTextContent("YOUR_API_KEY")
  expect(screen.getByRole("dialog")).toHaveTextContent(
    'Sandbox.connect("sbx-42")',
  )
  expect(screen.getByText(/Use one of your API keys\./)).toHaveTextContent(
    "Use one of your API keys. Manage keys on the API keys page.",
  )
  expect(screen.getByRole("link", { name: "API keys page" })).toHaveAttribute(
    "href",
    "/api-keys/",
  )
  expect(screen.getByRole("link", { name: "API keys page" })).toHaveClass(
    "focus-visible:outline-none",
    "focus-visible:ring-2",
    "focus-visible:ring-border-focus",
  )
  expect(screen.getByRole("button", { name: "Done" })).toHaveClass("bg-primary")
})

it("shows the Python connection syntax when switching tabs with a key", async () => {
  const user = userEvent.setup()
  keyState.data = [{ name: "Existing key" }]
  renderDialog()

  await user.click(screen.getByRole("button", { name: "Python" }))

  expect(screen.getByRole("dialog")).not.toHaveTextContent("YOUR_API_KEY")
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "# export SUPERSERVE_API_KEY=ss_live_...",
  )
  expect(screen.getByText(/Use one of your API keys\./)).toHaveTextContent(
    "Use one of your API keys. Manage keys on the API keys page.",
  )
  expect(screen.getByRole("link", { name: "API keys page" })).toHaveAttribute(
    "href",
    "/api-keys/",
  )
  expect(screen.getByRole("dialog")).toHaveTextContent(
    'Sandbox.connect("sbx-42")',
  )
  expect(screen.getByRole("dialog")).not.toHaveTextContent("api_key=")
})

it.each(LANGUAGES)(
  "wraps $label code and copies the full snippet with a UUID sandbox ID",
  async ({ label, value }) => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined)
    const sandboxId = "3f6c2a9e-8b41-4d7a-9c2e-5a1b7d3e9f04"
    const snippet = getConnectSnippet(value, sandboxId)
    keyState.data = [{ name: "Existing key" }]
    renderDialog(sandboxId)

    await user.click(screen.getByRole("button", { name: label }))

    const copyButtons = screen.getAllByRole("button", { name: "Copy" })
    expect(copyButtons).toHaveLength(2)
    for (const copyButton of copyButtons) {
      expect(copyButton).toHaveClass(
        "focus-visible:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-border-focus",
      )
      expect(copyButton.previousElementSibling).toHaveClass(
        "min-w-0",
        "flex-1",
        "[&_pre]:whitespace-pre-wrap",
        "[&_pre]:[overflow-wrap:anywhere]",
      )
      expect(copyButton.parentElement).toHaveClass("gap-3")
    }

    const runCopyButton = copyButtons[1]
    const runBox = runCopyButton.parentElement!
    expect(runBox).not.toHaveClass("max-h-[180px]")
    expect(runBox).not.toHaveClass("overflow-y-auto")
    await waitFor(() => {
      expect(runBox.querySelector("code")?.textContent).toBe(snippet)
    })
    expect(runBox.querySelector("code")).toHaveTextContent(
      `Sandbox.connect("${sandboxId}")`,
    )

    await user.click(runCopyButton)
    expect(writeText).toHaveBeenCalledExactlyOnceWith(snippet)
  },
)
