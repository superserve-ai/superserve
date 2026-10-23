import "server-only"
import {
  normalizeRequestedOffer,
  REQUESTED_OFFER_LABELS,
} from "@/lib/auth/requested-offer"
import {
  SIGNUP_AFFILIATION_LABELS,
  type SignupDetails,
} from "@/lib/auth/signup-review"
import sendToSlackHook from "@/lib/slack/send-to-webhook"
import {
  formatSignupEligibility,
  type SignupEligibilityPresentationOutcome,
} from "@/lib/slack/signup-eligibility"

// Names, emails and signup details are user-controlled; keep Slack from
// parsing them as mentions or links.
function escapeSlack(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function detailFields(details: SignupDetails | undefined) {
  if (!details) return []
  return [
    {
      type: "mrkdwn",
      text: `*Company:* ${details.company ? escapeSlack(details.company) : "—"}`,
    },
    {
      type: "mrkdwn",
      text: `*Affiliation:* ${details.affiliation ? SIGNUP_AFFILIATION_LABELS[details.affiliation] : "—"}`,
    },
    ...(details.ycLink
      ? [{ type: "mrkdwn", text: `*YC link:* ${escapeSlack(details.ycLink)}` }]
      : []),
  ]
}

/**
 * Send the original signup notification from a server-only continuation.
 *
 * Callers must first obtain and normalize the trusted signup outcome. Keeping
 * this helper outside a `use server` module prevents browser callers from
 * choosing an authoritative-looking eligibility annotation themselves.
 */
export const notifySlackOfNewUser = async (
  email: string,
  fullName: string | null,
  provider: string | null,
  outcome?: SignupEligibilityPresentationOutcome,
  offer?: string,
  details?: SignupDetails,
) => {
  try {
    const requestedOffer = normalizeRequestedOffer(offer)
    const annotation = formatSignupEligibility(outcome)
    const annotationText = annotation.emoji
      ? `${annotation.emoji} ${annotation.text}`
      : annotation.text
    await sendToSlackHook({
      text: `New User Sign Up — ${annotationText}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "New User Sign Up", emoji: true },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Email:* ${email ? escapeSlack(email) : "N/A"}`,
            },
            {
              type: "mrkdwn",
              text: `*Name:* ${fullName ? escapeSlack(fullName) : "N/A"}`,
            },
            { type: "mrkdwn", text: `*Provider:* ${provider || "N/A"}` },
            ...(requestedOffer
              ? [
                  {
                    type: "mrkdwn",
                    text: `*Interested in:* ${REQUESTED_OFFER_LABELS[requestedOffer]}`,
                  },
                ]
              : []),
            ...detailFields(details),
            {
              type: "mrkdwn",
              text: `*Signup Eligibility:* ${annotationText}`,
            },
          ],
        },
        { type: "divider" },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Signed up on ${new Date().toLocaleString()}`,
            },
          ],
        },
      ],
    })
  } catch (error) {
    console.error("Error sending Slack message:", error)
  }
}
