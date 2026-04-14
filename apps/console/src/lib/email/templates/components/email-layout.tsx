import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components"

interface EmailLayoutProps {
  preview: string
  children: React.ReactNode
}

export const EmailLayout = ({ preview, children }: EmailLayoutProps) => (
  <Html>
    <Head>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Geist+Mono:wght@500&display=swap"
      />
    </Head>
    <Preview>{preview}</Preview>
    <Body style={body}>
      <Container style={container}>
        <Section style={header}>
          <Img
            src="https://superserve.ai/assets/logo-light.png"
            width="173"
            height="32"
            alt="Superserve"
          />
        </Section>
        <Section style={card}>{children}</Section>
        <Section style={footer}>
          <Text style={footerText}>SUPERSERVE</Text>
          <Text style={footerSubtext}>
            455 Market St Ste 1940 PMB 924076, San Francisco, California
            94105-2448 US.
          </Text>
          <Text style={footerSubtext}>
            Questions? Contact{" "}
            <Link href="mailto:support@superserve.ai" style={footerSubtextLink}>
              support@superserve.ai
            </Link>
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

const body: React.CSSProperties = {
  backgroundColor: "#0a0a0a",
  fontFamily: "'Instrument Sans', Helvetica, Arial, sans-serif",
  margin: "0",
  padding: "0",
  color: "#e5e5e5",
}

const container: React.CSSProperties = {
  maxWidth: "520px",
  margin: "0 auto",
  padding: "40px 20px",
}

const header: React.CSSProperties = {
  textAlign: "center",
  padding: "0 0 32px 0",
}

const card: React.CSSProperties = {
  backgroundColor: "#171717",
  border: "1px dashed #262626",
  padding: "40px 32px",
}

const footer: React.CSSProperties = {
  padding: "32px 0 0 0",
  textAlign: "center",
}

const footerText: React.CSSProperties = {
  color: "#737373",
  fontFamily: "'Geist Mono', monospace",
  fontSize: "11px",
  fontWeight: 500,
  letterSpacing: "0.08em",
  lineHeight: "20px",
  margin: "0 0 8px 0",
}

const footerSubtext: React.CSSProperties = {
  color: "#525252",
  fontSize: "11px",
  lineHeight: "18px",
  margin: "0",
}

const footerSubtextLink: React.CSSProperties = {
  color: "#e5e5e5",
  fontSize: "11px",
  lineHeight: "18px",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
}
