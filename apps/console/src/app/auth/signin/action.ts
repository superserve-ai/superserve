"use server";

import sendToSlackHook from "@/lib/slack/send-to-webhook";

export const notifySlackOfNewUser = async (
  email: string,
  fullName: string | null,
  provider: string | null,
) => {
  try {
    if (!email) return;
    await sendToSlackHook({
      text: "New User Sign Up",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "New User Sign Up", emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Email:* ${email}` },
            { type: "mrkdwn", text: `*Name:* ${fullName || "N/A"}` },
            { type: "mrkdwn", text: `*Provider:* ${provider || "N/A"}` },
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
    });
  } catch (error) {
    console.error("Error sending Slack message:", error);
  }
};

export default notifySlackOfNewUser;
