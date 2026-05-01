import { Button, Heading, Text } from "@react-email/components"
import { EmailLayout } from "./components/email-layout"

interface WelcomeEmailProps {
  name: string
  dashboardUrl: string
}

const MEETING_URL = "https://www.superserve.ai/meet/"

const getFirstName = (name: string) => name.trim().split(/\s+/)[0] || "there"

export const WelcomeEmail = ({ name, dashboardUrl }: WelcomeEmailProps) => {
  const firstName = getFirstName(name)
  return (
    <EmailLayout preview={`Welcome to Superserve, ${firstName}`}>
      <Heading style={heading}>Welcome to Superserve</Heading>
      <Text style={paragraph}>Hi {firstName},</Text>
      <Text style={paragraph}>
        I am the founder of Superserve and I&apos;d love to give you the VIP
        treatment. Happy to answer any questions or help you get set up (for
        free!). Grab time on my calendar link below.
      </Text>
      <Button style={primaryButton} href={dashboardUrl}>
        View Account
      </Button>
      <Button style={secondaryButton} href={MEETING_URL}>
        Book a Meeting
      </Button>
    </EmailLayout>
  )
}

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

const primaryButton: React.CSSProperties = {
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

const secondaryButton: React.CSSProperties = {
  backgroundColor: "transparent",
  color: "#e5e5e5",
  fontFamily: "'Geist Mono', monospace",
  fontSize: "12px",
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  textDecoration: "none",
  textAlign: "center",
  display: "block",
  padding: "13px 24px",
  margin: "12px 0 0 0",
  border: "1px dashed #404040",
}

WelcomeEmail.PreviewProps = {
  name: "Jeet",
  dashboardUrl: "https://console.superserve.ai",
} satisfies WelcomeEmailProps

export default WelcomeEmail
