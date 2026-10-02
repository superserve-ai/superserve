import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSendToSlackHook = vi.fn()
vi.mock("@/lib/slack/send-to-webhook", () => ({
  default: (...args: unknown[]) => mockSendToSlackHook(...args),
}))

import { notifySlackOfNewUser } from "./action"

describe("notifySlackOfNewUser", () => {
  beforeEach(() => {
    mockSendToSlackHook.mockReset().mockResolvedValue(undefined)
  })

  it("keeps identity fields and annotates the original payload", async () => {
    await notifySlackOfNewUser("user@example.com", "Test User", "google", {
      kind: "eligible",
    })

    expect(mockSendToSlackHook).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "✅ Signup Fingerprint eligible for first account in East",
        ),
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "header",
            text: expect.objectContaining({ text: "New User Sign Up" }),
          }),
          expect.objectContaining({
            type: "section",
            fields: expect.arrayContaining([
              { type: "mrkdwn", text: "*Email:* user@example.com" },
              { type: "mrkdwn", text: "*Name:* Test User" },
              { type: "mrkdwn", text: "*Provider:* google" },
              {
                type: "mrkdwn",
                text: "*Signup Eligibility:* ✅ Signup Fingerprint eligible for first account in East",
              },
            ]),
          }),
        ]),
      }),
    )
  })

  it("uses safe blocked and unavailable annotations", async () => {
    await notifySlackOfNewUser("", null, "google", {
      kind: "blocked",
      reason: "blocked_email",
    })
    expect(mockSendToSlackHook.mock.calls[0][0].text).toContain(
      "❌ Signup blocked by configured signup restriction",
    )
    expect(mockSendToSlackHook.mock.calls[0][0].text).not.toContain("N/A")

    await notifySlackOfNewUser("user@example.com", null, "google")
    expect(mockSendToSlackHook.mock.calls[1][0].text).toContain(
      "Signup eligibility unavailable",
    )
  })

  it("contains webhook failures", async () => {
    mockSendToSlackHook.mockRejectedValueOnce(new Error("webhook down"))
    await expect(
      notifySlackOfNewUser("user@example.com", null, "email", {
        kind: "unavailable",
      }),
    ).resolves.toBeUndefined()
  })
})
