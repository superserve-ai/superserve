import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const send = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock("./send-to-webhook", () => ({ default: send }))

import { notifySlackOfNewUser } from "./signup-notification"

describe("requested offer in signup notification", () => {
  beforeEach(() => send.mockClear())

  it.each([
    ["free", "Free"],
    ["pro_monthly", "Pro Monthly"],
    ["pro_annual", "Pro Annual"],
    ["yc_2026", "YC"],
    ["arbitrary_plan", undefined],
    ["__proto__", undefined],
    [undefined, undefined],
  ])(
    "renders only the allowlisted label for %s beside eligibility",
    async (offer, label) => {
      await notifySlackOfNewUser(
        "user@example.com",
        "User",
        "email",
        { kind: "blocked" },
        offer,
      )
      const fields = send.mock.lastCall![0].blocks[1].fields as Array<{
        text: string
      }>
      expect(
        fields.filter(({ text }) => text.startsWith("*Requested offer:*")),
      ).toEqual(
        label ? [{ type: "mrkdwn", text: `*Requested offer:* ${label}` }] : [],
      )
      expect(fields).toContainEqual({
        type: "mrkdwn",
        text: "*Signup Eligibility:* ❌ Signup blocked by signup safety policy",
      })
    },
  )
})

describe("signup notification fields", () => {
  beforeEach(() => send.mockClear())
  afterEach(() => vi.useRealTimers())

  const fields = () =>
    send.mock.lastCall![0].blocks[1].fields as Array<{ text: string }>

  it("keeps user-controlled names and emails from triggering mentions or links", async () => {
    await notifySlackOfNewUser(
      "<!channel>@example.com",
      "<!here> <https://example.com|Approve>",
      "email",
    )
    expect(fields()).toEqual(
      expect.arrayContaining([
        { type: "mrkdwn", text: "*Email:* &lt;!channel&gt;@example.com" },
        {
          type: "mrkdwn",
          text: "*Name:* &lt;!here&gt; &lt;https://example.com|Approve&gt;",
        },
      ]),
    )
  })

  it("flags an Enterprise signup waiting for setup", async () => {
    await notifySlackOfNewUser(
      "user@example.com",
      "User",
      "google",
      undefined,
      undefined,
      true,
    )
    expect(fields().some(({ text }) => text.startsWith("*Enterprise:*"))).toBe(
      true,
    )
  })

  it("adds no Enterprise field otherwise", async () => {
    await notifySlackOfNewUser("user@example.com", "User", "google")
    expect(fields().some(({ text }) => text.startsWith("*Enterprise:*"))).toBe(
      false,
    )
  })

  it("preserves signup time when notification delivery runs later", async () => {
    vi.useFakeTimers()
    const signedUpAt = new Date("2026-11-23T17:36:21Z")
    vi.setSystemTime(new Date("2026-11-23T18:00:00Z"))
    await notifySlackOfNewUser(
      "user@example.com",
      "User",
      "google",
      undefined,
      undefined,
      false,
      signedUpAt,
    )
    expect(send.mock.lastCall![0].blocks[3].elements[0].text).toBe(
      `Signed up on ${signedUpAt.toLocaleString()}`,
    )
  })

  it("defaults to the current time for callers without a signup timestamp", async () => {
    vi.useFakeTimers()
    const now = new Date("2026-11-23T17:36:21Z")
    vi.setSystemTime(now)
    await notifySlackOfNewUser("user@example.com", "User", "google")
    expect(send.mock.lastCall![0].blocks[3].elements[0].text).toBe(
      `Signed up on ${now.toLocaleString()}`,
    )
  })
})
