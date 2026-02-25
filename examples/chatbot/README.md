# Chatbot

A minimal chatbot built with [Claude Agent SDK](https://docs.anthropic.com/en/docs/agent-sdk) and deployed on [Superserve](https://superserve.ai).

This example shows the changes needed to take a standard Claude Agent SDK script and make it deployable with Superserve. See the [quickstart](https://docs.superserve.ai/quickstart) for a full walkthrough.

## Deploy to Superserve

```bash
superserve init
superserve deploy
superserve secrets set chatbot ANTHROPIC_API_KEY=sk-ant-...
superserve run chatbot
```
