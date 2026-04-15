import { Button, Heading, Text } from "@react-email/components"
import { EmailLayout } from "./components/email-layout"

interface ConfirmationEmailProps {
  confirmationUrl: string
}

export const ConfirmationEmail = ({
  confirmationUrl,
}: ConfirmationEmailProps) => (
  <EmailLayout preview="Confirm your Superserve account">
    <Heading style={heading}>Confirm your account</Heading>
    <Text style={paragraph}>
      Verify your email to finish setting up your Superserve account.
    </Text>
    <Button style={button} href={confirmationUrl}>
      Confirm Email
    </Button>
    <Text style={disclaimer}>
      Didn&apos;t create an account? You can safely ignore this email.
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

export default ConfirmationEmail
