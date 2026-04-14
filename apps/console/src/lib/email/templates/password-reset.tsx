import { Button, Heading, Text } from "@react-email/components"
import { EmailLayout } from "./components/email-layout"

interface PasswordResetEmailProps {
  email: string
  resetUrl: string
}

export const PasswordResetEmail = ({
  email,
  resetUrl,
}: PasswordResetEmailProps) => (
  <EmailLayout preview="Reset your Superserve password">
    <Heading style={heading}>Reset your password</Heading>
    <Text style={paragraph}>
      We received a request to reset the password for{" "}
      <strong style={strong}>{email}</strong>.
    </Text>
    <Text style={paragraph}>
      Set a new password below. This link expires in 1 hour.
    </Text>
    <Button style={button} href={resetUrl}>
      Reset Password
    </Button>
    <Text style={disclaimer}>
      Didn&apos;t request this? You can safely ignore this email — your password
      will remain unchanged.
    </Text>
  </EmailLayout>
)

const heading: React.CSSProperties = {
  fontFamily: "'Instrument Sans', Helvetica, Arial, sans-serif",
  color: "#e5e5e5",
  fontSize: "20px",
  fontWeight: 600,
  letterSpacing: "-0.01em",
  margin: "0 0 24px 0",
}

const paragraph: React.CSSProperties = {
  color: "#a3a3a3",
  fontSize: "14px",
  lineHeight: "24px",
  margin: "0 0 16px 0",
}

const strong: React.CSSProperties = {
  color: "#e5e5e5",
  fontWeight: 500,
}

const button: React.CSSProperties = {
  backgroundColor: "#e5e5e5",
  color: "#0a0a0a",
  fontFamily: "'Geist Mono', monospace",
  fontSize: "12px",
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  textDecoration: "none",
  textAlign: "center",
  display: "block",
  padding: "14px 24px",
  margin: "28px 0 0 0",
}

const disclaimer: React.CSSProperties = {
  color: "#737373",
  fontSize: "12px",
  lineHeight: "20px",
  margin: "28px 0 0 0",
}

export default PasswordResetEmail
