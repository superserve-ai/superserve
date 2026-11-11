import { ToastProvider } from "@superserve/ui"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"

import { ConnectSandboxDialog } from "./connect-sandbox-dialog"

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

beforeEach(() => {
  vi.clearAllMocks()
  keyState.data = []
  keyState.isPending = false
  mutation.data = undefined
  mutation.isPending = false
})

function renderDialog() {
  return render(
    <ToastProvider>
      <ConnectSandboxDialog sandboxId="sbx-42" open onOpenChange={vi.fn()} />
    </ToastProvider>,
  )
}

it("prioritizes creating a key and hides the run snippet until a key exists", async () => {
  const user = userEvent.setup()
  renderDialog()

  expect(screen.getByText("1. Create an API key")).toBeInTheDocument()
  expect(screen.getByText("2. Install the SDK")).toBeInTheDocument()
  expect(screen.getByText("3. Run this code")).toBeInTheDocument()
  expect(
    screen.getByText(
      "Your code uses this key to connect to sandboxes. You see it once.",
    ),
  ).toBeInTheDocument()
  expect(
    screen.getByText("Create an API key first. The code appears here."),
  ).toBeInTheDocument()
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

it("shows the newly created key and uses it in the run snippet", () => {
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
  expect(screen.getByRole("dialog")).toHaveTextContent(`apiKey: "${key}"`)
  expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(2)
  expect(screen.getByRole("button", { name: "Done" })).toHaveClass("bg-primary")
})

it("shows two steps and a key placeholder when the team already has a key", () => {
  keyState.data = [{ name: "Existing key" }]
  renderDialog()

  expect(screen.getByText("1. Install the SDK")).toBeInTheDocument()
  expect(screen.getByText("2. Run this code")).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Create API key" }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole("dialog")).toHaveTextContent('apiKey: "YOUR_API_KEY"')
  expect(screen.getByRole("button", { name: "Done" })).toHaveClass("bg-primary")
})

it("shows the Python connection syntax when switching tabs with a key", async () => {
  const user = userEvent.setup()
  keyState.data = [{ name: "Existing key" }]
  renderDialog()

  await user.click(screen.getByRole("button", { name: "Python" }))

  expect(screen.getByRole("dialog")).toHaveTextContent('api_key="YOUR_API_KEY"')
})
