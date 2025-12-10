"""LangChain agent adapter for Ray distributed tool execution."""

import logging
from collections.abc import Callable
from typing import Any

from ray_agents.adapters.abc import AgentAdapter, AgentFramework

logger = logging.getLogger(__name__)


class LangChainAdapter(AgentAdapter):
    """
    Adapter for LangChain agents with Ray distributed tool execution.

    Wraps LangChain's native agent execution while executing tools as Ray tasks.
    LangChain maintains full control over the agent flow; Ray provides distributed
    execution. Works with any LangChain LLM provider (ChatOpenAI, ChatAnthropic, etc.).
    """

    framework = AgentFramework.LANGCHAIN

    def __init__(
        self,
        llm: Any,
        system_prompt: str | None = None,
    ):
        """
        Initialize LangChain agent adapter.

        Args:
            llm: Pre-configured LangChain LLM (ChatOpenAI, ChatAnthropic, etc.)
            system_prompt: Optional system prompt for the agent
        """
        self.llm = llm
        self.system_prompt = system_prompt or "You are a helpful AI assistant."
        self._agent: Any | None = None
        self._cached_tool_signature: tuple | None = None

    async def run(
        self, message: str, messages: list[dict], tools: list[Any]
    ) -> dict[str, Any]:
        """
        Execute LangChain agent with Ray distributed tools.

        Args:
            message: Current user message
            messages: Conversation history
            tools: List of Ray remote functions

        Returns:
            Response dict with 'content' key and metadata
        """
        try:
            langchain_tools = self._wrap_ray_tools(tools)
            response_text = await self._execute_agent(
                message, messages, langchain_tools
            )

            return {
                "content": response_text,
                "tools_available": len(tools),
                "llm": type(self.llm).__name__,
            }

        except Exception as e:
            logger.error(f"Error in LangChain adapter: {e}")
            raise

    def _get_or_create_agent(self, lc_tools: list[Any]) -> Any:
        """
        Get cached agent or create new one if tools changed.

        Only recreates the agent if the set of tools has changed,
        improving performance for repeated calls with same tools.

        Args:
            lc_tools: List of LangChain StructuredTool objects

        Returns:
            Cached or newly created LangChain agent
        """
        tool_signature = tuple(sorted(tool.name for tool in lc_tools))

        if self._agent is None or self._cached_tool_signature != tool_signature:
            from langchain.agents import create_agent

            self._agent = create_agent(self.llm, tools=lc_tools)
            self._cached_tool_signature = tool_signature

        return self._agent

    async def _execute_agent(
        self, message: str, messages: list[dict], tools: list[Callable]
    ) -> str:
        """
        Execute LangChain agent with tool calling.

        Uses LangChain's create_agent() to create a ReAct agent that can
        reason about which tools to use and call them as needed.

        Args:
            message: User message
            messages: Conversation history
            tools: Wrapped tools (execute via Ray when called)

        Returns:
            Response text from agent
        """
        try:
            from langchain_core.messages import (
                AIMessage,
                BaseMessage,
                HumanMessage,
                SystemMessage,
            )

            conversation_history: list[BaseMessage] = [
                SystemMessage(content=self.system_prompt)
            ]

            for msg in messages:
                if msg["role"] == "user":
                    conversation_history.append(HumanMessage(content=msg["content"]))
                elif msg["role"] == "assistant":
                    conversation_history.append(AIMessage(content=msg["content"]))

            conversation_history.append(HumanMessage(content=message))

            if not tools:
                response = await self.llm.ainvoke(conversation_history)
                return str(response.content)

            try:
                import langchain  # noqa: F401
            except ImportError as e:
                raise ImportError(
                    "LangChain agent requires 'langchain'. "
                    "Install with: pip install langchain"
                ) from e

            from langchain_core.tools import StructuredTool

            lc_tools = []
            for wrapped_tool in tools:
                try:
                    tool_name = wrapped_tool.__name__
                    tool_desc = wrapped_tool.__doc__ or f"Calls {tool_name}"
                    args_schema = getattr(wrapped_tool, "args_schema", None)

                    structured_tool = StructuredTool.from_function(
                        func=wrapped_tool,
                        name=tool_name,
                        description=tool_desc,
                        args_schema=args_schema,
                    )
                    lc_tools.append(structured_tool)
                except Exception as e:
                    logger.error(
                        f"Failed to create tool from {wrapped_tool.__name__}: {e}",
                        exc_info=True,
                    )

            if not lc_tools:
                raise ValueError("No tools could be created")

            agent = self._get_or_create_agent(lc_tools)

            try:
                result = await agent.ainvoke({"messages": conversation_history})

                final_message = result["messages"][-1]
                response_content = str(final_message.content)

                return response_content

            except Exception as e:
                logger.error(f"Error during agent execution: {e}", exc_info=True)
                raise

        except Exception as e:
            logger.error(f"Error in LangChain execution: {e}")
            raise
