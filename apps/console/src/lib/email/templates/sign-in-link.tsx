import { Button, Heading, Text } from "@react-email/components"

import { EmailLayout } from "./components/email-layout"

interface SignInLinkEmailProps {
  email: string
  signInUrl: string
}

export const SignInLinkEmail = ({ email, signInUrl }: SignInLinkEmailProps) => (
  <EmailLayout preview="Your Superserve sign-in link">
    <Heading style={heading}>Sign in to Superserve</Heading>
    <Text style={paragraph}>
      We received a request to sign in as{" "}
      <strong style={strong}>{email}</strong>.
    </Text>
    <Text style={paragraph}>
      Use the button below to sign in. This link expires in 1 hour and works
      once. Your password stays the same.
    </Text>
    <Button style={button} href={signInUrl}>
      Sign In
    </Button>
    <Text style={disclaimer}>
      Didn&apos;t request this? You can safely ignore this email.
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

export default SignInLinkEmail
