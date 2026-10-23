import { beforeEach, describe, expect, it, vi } from "vitest"

const send = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock("./send-to-webhook", () => ({ default: send }))

import { notifySlackOfNewUser } from "./signup-notification"

describe("requested offer in signup notification", () => {
  beforeEach(() => send.mockClear())

  it.each([
    ["free", "Free"],
    ["pro_monthly", "Pro Monthly"],
    ["pro_annual", "Pro Annual"],
    ["starter_annual", "Starter Annual"],
    ["enterprise", "Enterprise"],
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

describe("signup review details in signup notification", () => {
  beforeEach(() => send.mockClear())

  it("adds the review details without letting free text trigger Slack mentions", async () => {
    await notifySlackOfNewUser(
      "user@example.com",
      "User",
      "google",
      { kind: "unavailable" },
      "starter_monthly",
      {
        company: "<!channel> & Co",
        affiliation: "yc",
        ycLink: "https://example.com/<@U123>",
        plan: "starter",
        cadence: "monthly",
      },
    )
    const fields = send.mock.lastCall![0].blocks[1].fields
    expect(fields).toEqual(
      expect.arrayContaining([
        { type: "mrkdwn", text: "*Requested offer:* Starter Monthly" },
        { type: "mrkdwn", text: "*Company:* &lt;!channel&gt; &amp; Co" },
        { type: "mrkdwn", text: "*Affiliation:* YC" },
        {
          type: "mrkdwn",
          text: "*YC link:* https://example.com/&lt;@U123&gt;",
        },
      ]),
    )
  })
})
