/**
 * Create-stack wizard — client validation, inline server field errors that
 * keep the user's input, the 409 path, the double-submit guard, and the
 * invariant that the model key never lands anywhere but the request body.
 */

import { QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"
import { qmKeys } from "@/lib/api/query-keys"
import { qmTenant } from "@/test/qm-fixtures"
import { createQueryClient } from "@/test/react-query"

const mockCreate = vi.fn()
const mockCheckSlug = vi.fn()
vi.mock("@/lib/api/qm", () => ({
  createQmTenant: (...a: unknown[]) => mockCreate(...a),
  checkQmSlug: (...a: unknown[]) => mockCheckSlug(...a),
}))

const addToast = vi.fn()
// Base UI's Select is a custom listbox; a native <select> keeps the test
// about form behavior rather than popup mechanics.
vi.mock("@superserve/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@superserve/ui")>("@superserve/ui")
  return {
    ...actual,
    useToast: () => ({ addToast }),
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string
      onValueChange: (v: string) => void
      children: React.ReactNode
    }) => (
      <select value={value} onChange={(e) => onValueChange(e.target.value)}>
        {children}
      </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectPopup: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    SelectItem: ({
      value,
      disabled,
      children,
    }: {
      value: string
      disabled?: boolean
      children: React.ReactNode
    }) => (
      <option value={value} disabled={disabled}>
        {children}
      </option>
    ),
  }
})

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => nav }))
const posthog = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock("posthog-js/react", () => ({ usePostHog: () => posthog }))

import { CreateTenantForm } from "./create-tenant-form"

const KEY = "sk-ant-api03-SUPER-SECRET-KEY-VALUE"

function renderForm(email: string | null = "me@example.com") {
  const queryClient = createQueryClient()
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CreateTenantForm defaultAdminEmail={email} />
    </QueryClientProvider>,
  )
  return { ...utils, queryClient }
}

const field = (name: RegExp) => screen.getByRole("textbox", { name })
const keyField = () => screen.getByLabelText(/api key/i) as HTMLInputElement
const submit = () =>
  screen.getByRole("button", { name: /create stack|creating/i })

/** Fill every required field with valid values and wait for the slug check. */
async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field(/organization name/i), "Acme Inc")
  await user.type(keyField(), KEY)
  await waitFor(() => expect(mockCheckSlug).toHaveBeenCalledWith("acme-inc"))
  await screen.findByLabelText("Available")
}

describe("CreateTenantForm", () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockCheckSlug.mockReset().mockResolvedValue({ available: true })
    addToast.mockClear()
    nav.replace.mockClear()
    posthog.capture.mockClear()
  })

  it("derives the slug from the org name and shows the resulting URL", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(field(/organization name/i), "Pilot Team, Inc.")
    expect(field(/subdomain/i)).toHaveValue("pilot-team-inc")
    expect(
      screen.getAllByText("https://pilot-team-inc.qm.superserve.ai").length,
    ).toBeGreaterThan(0)

    // Editing the slug by hand detaches it from the org name.
    await user.clear(field(/subdomain/i))
    await user.type(field(/subdomain/i), "Pilot!")
    expect(field(/subdomain/i)).toHaveValue("pilot")
    await user.type(field(/organization name/i), " Extra")
    expect(field(/subdomain/i)).toHaveValue("pilot")
  })

  it("debounces the availability check and surfaces a taken slug", async () => {
    mockCheckSlug.mockResolvedValue({
      available: false,
      reason: "That subdomain is already in use.",
    })
    const user = userEvent.setup()
    renderForm()

    await user.type(field(/organization name/i), "Acme")
    // One check for the settled value, not one per keystroke.
    await waitFor(() => expect(mockCheckSlug).toHaveBeenCalledTimes(1))
    expect(mockCheckSlug).toHaveBeenCalledWith("acme")
    await screen.findByLabelText("Taken")

    await user.type(keyField(), KEY)
    await user.click(submit())
    expect(
      screen.getByText("That subdomain is already in use."),
    ).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("pre-fills the admin email and rejects free-mail domains client-side", async () => {
    const user = userEvent.setup()
    renderForm("me@example.com")
    expect(field(/admin email/i)).toHaveValue("me@example.com")

    await user.clear(field(/admin email/i))
    await user.type(field(/admin email/i), "me@gmail.com")
    await user.tab()
    expect(
      screen.getByText(/gmail\.com accounts can't administer/i),
    ).toBeInTheDocument()

    await user.type(field(/organization name/i), "Acme")
    await user.type(keyField(), KEY)
    await user.click(submit())
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("requires the key, the org name, and a slug before submitting", async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(submit())

    expect(screen.getByText(/organization's name/i)).toBeInTheDocument()
    expect(screen.getByText(/choose a subdomain/i)).toBeInTheDocument()
    expect(screen.getByText(/enter your provider api key/i)).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("defaults the harness to pi and resets it when the provider stops supporting it", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole("button", { name: /advanced/i }))
    const [provider, harness] = screen.getAllByRole("combobox")
    expect(harness).toHaveValue("pi")
    expect(
      (screen.getByRole("option", { name: /codex/i }) as HTMLOptionElement)
        .disabled,
    ).toBe(true)

    await user.selectOptions(harness, "claude")
    expect(harness).toHaveValue("claude")
    await user.selectOptions(provider, "openai")
    expect(harness).toHaveValue("pi")
    expect(
      (screen.getByRole("option", { name: /codex/i }) as HTMLOptionElement)
        .disabled,
    ).toBe(false)
    expect(
      (screen.getByRole("option", { name: /claude/i }) as HTMLOptionElement)
        .disabled,
    ).toBe(true)
  })

  it("clears the key when the provider changes", async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(keyField(), KEY)
    expect(keyField().value).toBe(KEY)
    expect(screen.getByText("••••••••")).toBeInTheDocument()

    const [provider] = screen.getAllByRole("combobox")
    await user.selectOptions(provider, "openai")

    expect(keyField().value).toBe("")
    expect(screen.queryByText("••••••••")).not.toBeInTheDocument()
    expect(screen.getByLabelText(/openai api key/i)).toBeInTheDocument()
    await user.click(submit())
    expect(screen.getByText(/enter your provider api key/i)).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("submits the full request and navigates to the new stack", async () => {
    mockCreate.mockResolvedValue(qmTenant({ id: "t-new" }))
    const user = userEvent.setup()
    renderForm()
    await fillValid(user)
    await user.click(screen.getByRole("radio", { name: /slack sso/i }))

    await user.click(submit())

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/qm/t-new"))
    expect(mockCreate).toHaveBeenCalledWith({
      slug: "acme-inc",
      orgName: "Acme Inc",
      adminEmail: "me@example.com",
      signIn: "slack",
      modelProvider: "anthropic",
      modelKey: KEY,
      harness: "pi",
    })
    // The key was consumed by the request and cleared from the field.
    expect(keyField().value).toBe("")
  })

  it("renders server field errors inline without losing input", async () => {
    mockCreate.mockRejectedValue(
      new ApiError(400, "validation_failed", "Validation failed", {
        adminEmail: "Domain is not verified for this team.",
        modelKey: "Anthropic rejected this key.",
        region: "Unsupported region.",
      }),
    )
    const user = userEvent.setup()
    renderForm()
    await fillValid(user)
    await user.click(submit())

    expect(
      await screen.findByText("Domain is not verified for this team."),
    ).toBeInTheDocument()
    expect(screen.getByText("Anthropic rejected this key.")).toBeInTheDocument()
    // Unknown fields land near the submit button.
    expect(screen.getByRole("alert")).toHaveTextContent("Unsupported region.")
    // Nothing was reset.
    expect(field(/organization name/i)).toHaveValue("Acme Inc")
    expect(field(/admin email/i)).toHaveValue("me@example.com")
    expect(keyField().value).toBe(KEY)
    expect(addToast).not.toHaveBeenCalled()

    // Editing the field clears its server error.
    await user.type(field(/admin email/i), "x")
    expect(
      screen.queryByText("Domain is not verified for this team."),
    ).not.toBeInTheDocument()
  })

  it("refreshes the tenant list after a failure that may have left a tenant behind", async () => {
    mockCreate.mockRejectedValue(
      new ApiError(
        502,
        "bad_gateway",
        "The provision run could not be started.",
      ),
    )
    const user = userEvent.setup()
    const { queryClient } = renderForm()
    const listKey = [...qmKeys.list(), "self"]
    queryClient.setQueryData(listKey, [])
    await fillValid(user)
    await user.click(submit())

    await waitFor(() =>
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true),
    )
    expect(addToast).toHaveBeenCalledWith(
      "The provision run could not be started.",
      "error",
    )
    // Validation failures leave the list alone: nothing was created.
    queryClient.setQueryData(listKey, [])
    mockCreate.mockRejectedValue(
      new ApiError(400, "validation_failed", "Validation failed", {
        slug: "Bad slug.",
      }),
    )
    await user.click(submit())
    await screen.findByText("Bad slug.")
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false)
  })

  it("shows a 409 near the submit button", async () => {
    mockCreate.mockRejectedValue(
      new ApiError(409, "slug_taken", "acme-inc was just taken."),
    )
    const user = userEvent.setup()
    renderForm()
    await fillValid(user)
    await user.click(submit())

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "acme-inc was just taken.",
    )
  })

  it("cannot be submitted twice while a request is in flight", async () => {
    let resolve!: (t: unknown) => void
    mockCreate.mockReturnValue(new Promise((r) => (resolve = r)))
    const user = userEvent.setup()
    renderForm()
    await fillValid(user)

    const form = submit().closest("form") as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)
    await user.click(submit())
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(submit()).toBeDisabled()

    resolve(qmTenant({ id: "t-new" }))
    await waitFor(() => expect(nav.replace).toHaveBeenCalled())
  })

  it("keeps the model key out of every serialized surface", async () => {
    mockCreate.mockRejectedValue(
      new ApiError(400, "validation_failed", "Validation failed", {
        modelKey: "Rejected.",
      }),
    )
    const user = userEvent.setup()
    const { queryClient, container } = renderForm()
    await fillValid(user)
    await user.click(submit())
    await screen.findByText("Rejected.")

    // Request body is the one place it travels.
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ modelKey: KEY })

    // Not in the mutation's stored variables, nor any query data.
    const mutations = queryClient.getMutationCache().getAll()
    expect(mutations.length).toBeGreaterThan(0)
    expect(JSON.stringify(mutations.map((m) => m.state))).not.toContain(KEY)
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state),
      ),
    ).not.toContain(KEY)
    // Not in analytics.
    expect(JSON.stringify(posthog.capture.mock.calls)).not.toContain(KEY)
    // Not in the rendered markup (the input holds it as a DOM property only).
    expect(container.innerHTML).not.toContain(KEY)
    expect(document.body.innerHTML).not.toContain(KEY)
    // Not in the URL.
    expect(JSON.stringify(nav.replace.mock.calls)).not.toContain(KEY)
    expect(JSON.stringify(nav.push.mock.calls)).not.toContain(KEY)
  })
})
