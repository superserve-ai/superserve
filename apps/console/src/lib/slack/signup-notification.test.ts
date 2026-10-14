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
