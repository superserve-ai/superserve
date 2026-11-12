import { roleLabel } from "@/lib/team/roles"

// Every string on the /invite/<token> page lives here so the wording can be
// reviewed and edited in one place. Functions take the dynamic parts.
export const INVITE_COPY = {
  roleInvitation: (team: string, role: string) =>
    `You're invited to join ${team} as ${roleLabel(role)}.`,
  ownerNotice:
    "Owners have full access to this team's sandboxes, billing, and members.",

  signedOut: {
    title: (team: string) => `You're invited to ${team}`,
    body: "Create an account or sign in with the invited email address to join this team as an Owner.",
    createAccount: "Create account",
    signIn: "Sign in",
    expires: (date: string) => `This invitation expires ${date}.`,
  },

  confirm: {
    title: (team: string) => `You're invited to ${team}`,
    body: "Join as an Owner with full access. You keep your current team and data, and you can switch teams any time from the team menu in the sidebar.",
    bodyNoTeam: "Join as an Owner with full access.",
    join: "Join team",
    joining: "Joining...",
    notNow: "Not now",
    signedInAs: (email: string) => `Signed in as ${email}`,
    notNowKeepsOpen: (date: string) =>
      `Not now keeps this invite open until ${date}.`,
    failed: "We couldn't add you to the team. Please try again.",
  },

  mismatch: {
    title: "Use your invited email",
    body: (invitedEmail: string, signedInEmail: string) =>
      `This invitation was sent to ${invitedEmail}, but you're signed in as ${signedInEmail}. Sign out and continue with the invited address.`,
    action: "Sign out and continue",
    working: "Signing out...",
    failed: "We couldn't sign you out. Please try again.",
  },

  alreadyMember: {
    title: (team: string) => `You're already part of ${team}`,
    body: "Your access to this team is unchanged. You can switch teams any time from the team menu in the sidebar.",
    action: "Continue",
  },

  notEligible: {
    title: "We can't add you to this team",
    body: "This account can't join a team from an invitation right now. Contact support if you think this is a mistake.",
    action: "Continue",
  },

  unavailable: {
    title: "This invitation is no longer available",
    body: "Ask a team owner to send you a new invitation.",
    continue: "Continue",
    createAccount: "Create account",
    signIn: "Sign in",
  },
} as const

export const INVITE_PAGE_TITLE = "Team invitation"
