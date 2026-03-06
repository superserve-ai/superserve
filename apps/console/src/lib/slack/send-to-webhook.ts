// biome-ignore lint/suspicious/noExplicitAny: deeply nested Slack block type
const sendToSlackHook = async (message: Record<string, any>) => {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!slackWebhookUrl) {
    console.error("SLACK_WEBHOOK_URL is not configured");
    return { success: false };
  }

  const response = await fetch(slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status}`);
  }
  return { success: true };
};

export default sendToSlackHook;
