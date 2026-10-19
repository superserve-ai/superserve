import { render } from "@react-email/components"
import nodemailer from "nodemailer"
import { Resend } from "resend"

interface SendEmailOptions {
  to: string
  subject: string
  react: React.ReactElement
}

interface EmailMessage extends SendEmailOptions {
  from: string
}

/** Delivers one message; throws on failure. */
type EmailTransport = (message: EmailMessage) => Promise<void>

function resendTransport(): EmailTransport | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn("Resend not configured — skipping email send")
    return null
  }
  const resend = new Resend(apiKey)
  return async (message) => {
    const { error } = await resend.emails.send(message)
    if (error) throw error
  }
}

function smtpTransport(): EmailTransport | null {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 25)
  if (!host) {
    console.error("EMAIL_TRANSPORT=smtp but SMTP_HOST is not configured")
    return null
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`SMTP_PORT is not a valid port: ${process.env.SMTP_PORT}`)
    return null
  }
  const transporter = nodemailer.createTransport({
    host,
    port,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  })
  return async ({ from, to, subject, react }) => {
    await transporter.sendMail({ from, to, subject, html: await render(react) })
  }
}

/**
 * The configured email transport: `EMAIL_TRANSPORT=resend` (default) or
 * `smtp` (`SMTP_HOST`, `SMTP_PORT` default 25; no auth, STARTTLS when the
 * server offers it, with certificate verification). An incomplete or unknown
 * selection yields null — never a fallback to another transport.
 */
function configuredTransport(): EmailTransport | null {
  const selected = process.env.EMAIL_TRANSPORT || "resend"
  if (selected === "resend") return resendTransport()
  if (selected === "smtp") return smtpTransport()
  console.error(
    `Unknown EMAIL_TRANSPORT "${selected}" — expected resend or smtp`,
  )
  return null
}

export const sendEmail = async ({ to, subject, react }: SendEmailOptions) => {
  const from = process.env.RESEND_FROM_ADDRESS
  const transport = configuredTransport()

  if (!transport) return { success: false }

  if (!from) {
    console.error("RESEND_FROM_ADDRESS is not configured")
    return { success: false }
  }

  try {
    await transport({ from, to, subject, react })
    return { success: true }
  } catch (err) {
    console.error("Failed to send email:", err)
    return { success: false }
  }
}
