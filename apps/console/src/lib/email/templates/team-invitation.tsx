import { Button, Heading, Text } from "@react-email/components"

import { knownTeamRole, TEAM_ROLES } from "@/lib/team/roles"

import { EmailLayout } from "./components/email-layout"

interface TeamInvitationEmailProps {
  role?: string
  teamName: string
  regionLabel: string
  inviterName: string
  expiresOn: string
  inviteUrl: string
}

// Header values must stay on one line whatever the team is called.
export const teamInvitationSubject = (teamName: string) =>
  `You're invited to join ${teamName.replace(/\s+/g, " ").trim()} on Superserve`

export const TeamInvitationEmail = ({
  teamName,
  regionLabel,
  inviterName,
  expiresOn,
  inviteUrl,
  role,
}: TeamInvitationEmailProps) => {
  const knownRole = knownTeamRole(role)
  return (
    <EmailLayout preview={`${inviterName} invited you to join ${teamName}`}>
      <Heading style={heading}>You&apos;re invited to join {teamName}</Heading>
      <Text style={paragraph}>
        {knownRole
          ? `${inviterName} invited you to join ${teamName} as ${TEAM_ROLES[knownRole].label} (${regionLabel}) on Superserve.`
          : `${inviterName} invited you to join ${teamName} (${regionLabel}) on Superserve as an Owner.`}
      </Text>
      <Text style={paragraph}>
        {knownRole
          ? TEAM_ROLES[knownRole].description
          : "Owners have full access to the team's sandboxes, billing, and members."}
      </Text>
      <Text style={paragraph}>This invitation expires on {expiresOn}.</Text>
      <Button style={primaryButton} href={inviteUrl}>
        View invitation
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

TeamInvitationEmail.PreviewProps = {
  teamName: "Acme Robotics",
  regionLabel: "US East",
  inviterName: "Jane Doe",
  expiresOn: "Jan 15, 2027",
  inviteUrl: "https://console.superserve.ai/invite/ssinv_use_example",
} satisfies TeamInvitationEmailProps

export default TeamInvitationEmail
