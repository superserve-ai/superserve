import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SandboxResponse } from "@/lib/api/types"

import { MetadataSection, NetworkSection } from "./sandbox-info-grid"

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock("@/hooks/use-sandboxes", () => ({
  usePatchSandbox: () => ({ mutate, isPending: false }),
}))

const sandbox: SandboxResponse = {
  id: "sbx-123",
  name: "example-sandbox",
  status: "active",
  vcpu_count: 2,
  memory_mib: 1024,
  access_token: "test-token",
  created_at: "2026-01-01T00:00:00Z",
  network: {
    allow_out: ["one.example.com", "two.example.com", "three.example.com"],
    deny_out: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  },
  metadata: {
    team: "example-team",
    region: "example-region",
    app: "example-app",
  },
}

beforeEach(() => vi.clearAllMocks())

describe("NetworkSection accessibility", () => {
  it.each(["allow", "deny"] as const)(
    "names the edit and %s removal buttons and removes the requested rule",
    async (kind) => {
      const user = userEvent.setup()
      render(<NetworkSection sandbox={sandbox} />)

      await user.click(
        screen.getByRole("button", { name: "Edit network rules" }),
      )

      for (const ruleKind of ["allow", "deny"]) {
        for (let i = 1; i <= 3; i++) {
          expect(
            screen.getByRole("button", {
              name: `Remove ${ruleKind} rule ${i}`,
            }),
          ).toBeInTheDocument()
        }
      }

      await user.click(
        screen.getByRole("button", { name: `Remove ${kind} rule 2` }),
      )

      const field = kind === "allow" ? "allow_out" : "deny_out"
      const rules = sandbox.network![field]!
      expect(screen.queryByDisplayValue(rules[1])).not.toBeInTheDocument()
      expect(screen.getByDisplayValue(rules[0])).toBeInTheDocument()
      expect(screen.getByDisplayValue(rules[2])).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: `Remove ${kind} rule 2` }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: `Remove ${kind} rule 3` }),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole("button", { name: "Save" }))
      expect(mutate).toHaveBeenCalledExactlyOnceWith(
        {
          id: sandbox.id,
          data: {
            network: {
              ...sandbox.network,
              [field]: [rules[0], rules[2]],
            },
          },
        },
        { onSuccess: expect.any(Function) },
      )
    },
  )
})

describe("MetadataSection accessibility", () => {
  it("names the edit and removal buttons and removes the requested entry", async () => {
    const user = userEvent.setup()
    render(<MetadataSection sandbox={sandbox} />)

    await user.click(screen.getByRole("button", { name: "Edit metadata" }))

    for (let i = 1; i <= 3; i++) {
      expect(
        screen.getByRole("button", { name: `Remove metadata entry ${i}` }),
      ).toBeInTheDocument()
    }

    await user.click(
      screen.getByRole("button", { name: "Remove metadata entry 2" }),
    )

    expect(screen.queryByDisplayValue("region")).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue("example-region")).not.toBeInTheDocument()
    expect(screen.getByDisplayValue("team")).toBeInTheDocument()
    expect(screen.getByDisplayValue("app")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Remove metadata entry 2" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Remove metadata entry 3" }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(mutate).toHaveBeenCalledExactlyOnceWith(
      {
        id: sandbox.id,
        data: { metadata: { team: "example-team", app: "example-app" } },
      },
      { onSuccess: expect.any(Function) },
    )
  })
})
