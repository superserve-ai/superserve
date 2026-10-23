import { Button, Heading, Text } from "@react-email/components"

import { CARD_BONUS_USD } from "@/lib/api/plan-catalog"

import { EmailLayout } from "./components/email-layout"

interface SignupApprovedEmailProps {
  // A confirmation magic link for unconfirmed email signups, else sign-in.
  url: string
  provider: "google" | "email"
  confirm?: boolean
}

export const signupApprovedSubject = () =>
  `You're approved — claim $${CARD_BONUS_USD} in free compute`

const claimCopy = () =>
  `Add your payment method to claim $${CARD_BONUS_USD} in free compute. You won't be charged.`

export const SignupApprovedEmail = ({
  url,
  provider,
  confirm = false,
}: SignupApprovedEmailProps) => (
  <EmailLayout preview={signupApprovedSubject()}>
    <Heading style={heading}>{signupApprovedSubject()}</Heading>
    <Text style={paragraph}>{claimCopy()}</Text>
    {provider === "google" && !confirm ? (
      <Text style={paragraph}>
        Sign in with Google using this email address to get started.
      </Text>
    ) : null}
    <Button style={button} href={url}>
      {confirm
        ? "Confirm email and get started"
        : provider === "google"
          ? "Sign in with Google"
          : "Sign in"}
    </Button>
    {confirm ? (
      <Text style={disclaimer}>
        Didn&apos;t create an account? You can safely ignore this email.
      </Text>
    ) : null}
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

SignupApprovedEmail.PreviewProps = {
  url: "https://console.superserve.ai/auth/signin",
  provider: "google",
} satisfies SignupApprovedEmailProps

export default SignupApprovedEmail
