import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const store = vi.hoisted(() => ({
  values: new Map<string, string>(),
  set: vi.fn(),
  delete: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = store.values.get(name)
      return value === undefined ? undefined : { name, value }
    },
    set: store.set,
    delete: store.delete,
  }),
}))

import {
  clearInviteIntent,
  hasInviteIntent,
  INVITE_INTENT_COOKIE,
  setInviteIntent,
} from "./intent"

const token = `ssinv_use_${"A".repeat(43)}`
const other = `ssinv_use_${"B".repeat(43)}`

beforeEach(() => {
  store.values.clear()
  store.set.mockReset()
  store.delete.mockReset()
})

describe("invite intent cookie", () => {
  it("is httpOnly, Secure, SameSite=Lax and lives a day", async () => {
    await setInviteIntent(token)

    expect(store.set).toHaveBeenCalledWith(
      INVITE_INTENT_COOKIE,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24,
      }),
    )
  })

  it("holds a hash, never the token", async () => {
    await setInviteIntent(token)

    const value = store.set.mock.calls[0][1] as string
    expect(value).toMatch(/^[0-9a-f]{64}$/)
    expect(value).not.toContain(token)
    expect(value).not.toContain("ssinv")
  })

  it("matches only the token it was set for", async () => {
    await setInviteIntent(token)
    store.values.set(INVITE_INTENT_COOKIE, store.set.mock.calls[0][1])

    expect(await hasInviteIntent(token)).toBe(true)
    expect(await hasInviteIntent(other)).toBe(false)
  })

  it("is absent without the cookie or with a tampered one", async () => {
    expect(await hasInviteIntent(token)).toBe(false)
    store.values.set(INVITE_INTENT_COOKIE, "nope")
    expect(await hasInviteIntent(token)).toBe(false)
  })

  it("ignores a malformed token", async () => {
    await setInviteIntent("//evil")
    expect(store.set).not.toHaveBeenCalled()
    expect(await hasInviteIntent("//evil")).toBe(false)
  })

  it("clears", async () => {
    await clearInviteIntent()
    expect(store.delete).toHaveBeenCalledWith(INVITE_INTENT_COOKIE)
  })
})
