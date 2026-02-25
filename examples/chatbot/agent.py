"""Minimal chatbot deployed on Superserve.

Shows how to take a Claude Agent SDK script and deploy it
with Superserve's @app.session pattern. Lines marked with
numbered comments are the Superserve additions.
"""

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
)

from superserve import App  # 1. Import

app = App(name="chatbot")  # 2. Declare

options = ClaudeAgentOptions(
    system_prompt="You are a friendly, helpful assistant. Keep responses concise.",
    model="haiku",
    permission_mode="bypassPermissions",
)


@app.session  # 3. Decorate
async def run(session):
    async with ClaudeSDKClient(options=options) as client:
        async for message, stream in session.turns():  # 4. Multi-turn loop
            stream.status("Thinking...")
            await client.query(prompt=message, session_id="chat")

            async for msg in client.receive_response():
                if isinstance(msg, AssistantMessage):
                    for block in msg.content:
                        if isinstance(block, TextBlock):
                            stream.write(block.text)  # 5. Stream back
                        elif isinstance(block, ToolUseBlock):
                            stream.status(f"Using {block.name}...")
                elif isinstance(msg, ResultMessage):
                    stream.metadata({"cost_usd": msg.total_cost_usd})


if __name__ == "__main__":
    app.run()  # 6. Start
