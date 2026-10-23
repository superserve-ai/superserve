import { Button, Heading, Text } from "@react-email/components"

import { EmailLayout } from "./components/email-layout"

interface SignupApprovedEmailProps {
  signInUrl: string
  provider: "google" | "email"
}

export const SignupApprovedEmail = ({
  signInUrl,
  provider,
}: SignupApprovedEmailProps) => (
  <EmailLayout preview="Your Superserve account is approved">
    <Heading style={heading}>You&apos;re approved</Heading>
    <Text style={paragraph}>
      Your Superserve account has been approved.{" "}
      {provider === "google"
        ? "Sign in with Google using this email address to finish setting up your account."
        : "Sign in to finish setting up your account."}
    </Text>
    <Button style={button} href={signInUrl}>
      {provider === "google" ? "Sign in with Google" : "Sign in"}
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

SignupApprovedEmail.PreviewProps = {
  signInUrl: "https://console.superserve.ai/auth/signin",
  provider: "google",
} satisfies SignupApprovedEmailProps

export default SignupApprovedEmail
