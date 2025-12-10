"""Pydantic AI agent adapter for Ray distributed tool execution."""

import logging
from typing import Any

from ray_agents.adapters.abc import AgentAdapter, AgentFramework

logger = logging.getLogger(__name__)


class PydanticAIAdapter(AgentAdapter):
    """
    Adapter for Pydantic AI agents with Ray distributed tool execution.

    Wraps Pydantic AI's agent execution while executing tools as Ray tasks.
    Pydantic AI maintains full control over the agent flow; Ray provides
    distributed execution.
    """

    framework = AgentFramework.PYDANTIC

    def __init__(
        self,
        agent: Any,
    ):
        """
        Initialize Pydantic AI agent adapter.

        Args:
            agent: Pre-configured Pydantic AI Agent instance
        """
        self.agent = agent

    async def run(
        self, message: str, messages: list[dict], tools: list[Any]
    ) -> dict[str, Any]:
        """
        Execute Pydantic AI agent with Ray distributed tools.

        Args:
            message: Current user message
            messages: Conversation history
            tools: List of Ray remote functions

        Returns:
            Response dict with 'content' key and metadata
        """
        try:
            wrapped_tools = self._wrap_ray_tools(tools)

            response_text = await self._execute_agent(message, messages, wrapped_tools)

            return {
                "content": response_text,
                "tools_available": len(tools),
            }

        except Exception as e:
            logger.error(f"Error in Pydantic AI adapter: {e}")
            raise

    async def _execute_agent(
        self, message: str, messages: list[dict], tools: list[Any]
    ) -> str:
        """
        Execute Pydantic AI agent with tool calling.

        Args:
            message: User message
            messages: Conversation history
            tools: Wrapped tools (execute via Ray when called)

        Returns:
            Response text from agent
        """
        try:
            try:
                from pydantic_ai import FunctionToolset
                from pydantic_ai.messages import (
                    ModelMessage,
                    ModelRequest,
                    ModelResponse,
                    UserPromptPart,
                )
            except ImportError as e:
                raise ImportError(
                    "Pydantic AI adapter requires 'pydantic-ai'. "
                    "Install with: pip install pydantic-ai"
                ) from e

            message_history: list[ModelMessage] = []
            for msg in messages[:-1]:
                if msg["role"] == "user":
                    message_history.append(
                        ModelRequest(parts=[UserPromptPart(content=msg["content"])])
                    )
                elif msg["role"] == "assistant":
                    message_history.append(ModelResponse(parts=[msg["content"]]))

            toolsets = []
            if tools:
                toolset = FunctionToolset()
                for tool_func in tools:
                    toolset.add_function(tool_func)
                toolsets.append(toolset)

            if not toolsets:
                result = await self.agent.run(message, message_history=message_history)
            else:
                result = await self.agent.run(
                    message, message_history=message_history, toolsets=toolsets
                )

            response_text = str(result.output)

            return response_text

        except Exception as e:
            logger.error(f"Error in Pydantic AI execution: {e}", exc_info=True)
            raise
