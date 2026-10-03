import "server-only"
import sendToSlackHook from "@/lib/slack/send-to-webhook"
import {
  formatSignupEligibility,
  type SignupEligibilityPresentationOutcome,
} from "@/lib/slack/signup-eligibility"

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
) => {
  try {
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
            { type: "mrkdwn", text: `*Email:* ${email || "N/A"}` },
            { type: "mrkdwn", text: `*Name:* ${fullName || "N/A"}` },
            { type: "mrkdwn", text: `*Provider:* ${provider || "N/A"}` },
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
