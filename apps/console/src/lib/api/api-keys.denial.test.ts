import { describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock("./api-keys-actions", () => ({
  listApiKeysAction: actions.list,
  createApiKeyAction: actions.create,
  revokeApiKeyAction: actions.revoke,
}))

import { createApiKey, listApiKeys, revokeApiKey } from "./api-keys"

describe("API-key action denial", () => {
  const denial = {
    code: "signup_blocked",
    message: "Signup is not available. Please try again later.",
  }

  it("shows the same denial from list, create, and revoke clients", async () => {
    actions.list.mockResolvedValueOnce(denial)
    actions.create.mockResolvedValueOnce(denial)
    actions.revoke.mockResolvedValueOnce(denial)

    for (const call of [
      () => listApiKeys(),
      () => createApiKey({ name: "blocked" }),
      () => revokeApiKey("key-1"),
    ]) {
      await expect(call()).rejects.toMatchObject({
        status: 403,
        code: denial.code,
        message: denial.message,
      })
    }
  })
})
