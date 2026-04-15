import { Button, Heading, Text } from "@react-email/components"
import { EmailLayout } from "./components/email-layout"

interface WelcomeEmailProps {
  name: string
  dashboardUrl: string
}

export const WelcomeEmail = ({ name, dashboardUrl }: WelcomeEmailProps) => (
  <EmailLayout preview={`Welcome to Superserve, ${name}`}>
    <Heading style={heading}>Welcome to Superserve</Heading>
    <Text style={paragraph}>Hi {name},</Text>
    <Text style={paragraph}>
      Your account is ready. Spin up isolated cloud sandboxes and run code in
      seconds — straight from the dashboard.
    </Text>
    <Button style={button} href={dashboardUrl}>
      Open Dashboard
    </Button>
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

export default WelcomeEmail
