import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockResendSend,
  mockResendConstructor,
  mockSendMail,
  mockCreateTransport,
} = vi.hoisted(() => {
  const mockResendSend = vi.fn()
  const mockSendMail = vi.fn()
  return {
    mockResendSend,
    mockResendConstructor: vi.fn((_apiKey: string) => ({
      emails: { send: mockResendSend },
    })),
    mockSendMail,
    mockCreateTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  }
})

vi.mock("resend", () => ({
  Resend: function Resend(apiKey: string) {
    return mockResendConstructor(apiKey)
  },
}))

vi.mock("nodemailer", () => ({
  default: { createTransport: mockCreateTransport },
}))

import { sendEmail } from "./send"

const message = {
  to: "user@example.com",
  subject: "Confirm your account",
  react: createElement("p", null, "Hello from the test"),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  mockResendSend.mockResolvedValue({ error: null })
  mockSendMail.mockResolvedValue({})
  vi.stubEnv("RESEND_API_KEY", "re_test")
  vi.stubEnv("RESEND_FROM_ADDRESS", "Superserve <team@example.com>")
  vi.stubEnv("EMAIL_TRANSPORT", "")
  vi.stubEnv("SMTP_HOST", "")
  vi.stubEnv("SMTP_PORT", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("sendEmail", () => {
  it("sends through Resend by default", async () => {
    await expect(sendEmail(message)).resolves.toEqual({ success: true })
    expect(mockResendConstructor).toHaveBeenCalledWith("re_test")
    expect(mockResendSend).toHaveBeenCalledWith({
      from: "Superserve <team@example.com>",
      ...message,
    })
    expect(mockCreateTransport).not.toHaveBeenCalled()
  })

  it("reports failure when Resend returns an error", async () => {
    mockResendSend.mockResolvedValue({ error: { message: "rejected" } })
    await expect(sendEmail(message)).resolves.toEqual({ success: false })
  })

  it("sends rendered HTML over SMTP when selected, without touching Resend", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "smtp")
    vi.stubEnv("SMTP_HOST", "127.0.0.1")
    vi.stubEnv("SMTP_PORT", "1025")

    await expect(sendEmail(message)).resolves.toEqual({ success: true })

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "127.0.0.1", port: 1025 }),
    )
    const sent = mockSendMail.mock.calls[0][0]
    expect(sent).toMatchObject({
      from: "Superserve <team@example.com>",
      to: message.to,
      subject: message.subject,
    })
    expect(sent.html).toContain("Hello from the test")
    expect(mockResendConstructor).not.toHaveBeenCalled()
  })

  it("defaults the SMTP port to 25", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "smtp")
    vi.stubEnv("SMTP_HOST", "mail.example.com")

    await sendEmail(message)

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "mail.example.com", port: 25 }),
    )
  })

  it.each([
    ["SMTP_HOST is missing", { SMTP_HOST: "" }],
    ["SMTP_PORT is invalid", { SMTP_HOST: "127.0.0.1", SMTP_PORT: "smtp" }],
  ])(
    "does not fall back to Resend when SMTP is selected and %s",
    async (_, env) => {
      vi.stubEnv("EMAIL_TRANSPORT", "smtp")
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)

      await expect(sendEmail(message)).resolves.toEqual({ success: false })

      expect(mockSendMail).not.toHaveBeenCalled()
      expect(mockResendSend).not.toHaveBeenCalled()
    },
  )

  it("does not fall back to Resend when SMTP delivery fails", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "smtp")
    vi.stubEnv("SMTP_HOST", "127.0.0.1")
    mockSendMail.mockRejectedValue(new Error("ECONNREFUSED"))

    await expect(sendEmail(message)).resolves.toEqual({ success: false })

    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it("rejects an unknown transport instead of guessing", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "sendgrid")

    await expect(sendEmail(message)).resolves.toEqual({ success: false })

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
  })
})
