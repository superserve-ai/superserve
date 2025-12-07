"""LangChain agent adapter for Ray distributed tool execution."""

import functools
import logging
from collections.abc import Callable
from typing import Any

import ray
from ray.util.annotations import DeveloperAPI

from ray_agents.adapters.abc import AgentAdapter

logger = logging.getLogger(__name__)


@DeveloperAPI
class LangChainAdapter(AgentAdapter):
    """
    Adapter for LangChain agents with Ray distributed tool execution.

    This adapter wraps LangChain's native agent execution (ReAct pattern, tool
    calling) while executing tools as Ray tasks. LangChain maintains full control
    over the agent flow; Ray provides distributed execution.

    When LangChain calls a tool, it's actually executing:
        result = ray.get(tool.remote(**args))

    This means tools automatically run on cluster nodes with appropriate resources.

    Example:
        >>> from ray_agents.adapters.langchain import LangChainAdapter
        >>> from langchain_openai import ChatOpenAI
        >>> import ray
        >>>
        >>> # Define tools with resource requirements
        >>> @ray.remote(num_gpus=1)
        >>> def tool_a(param: str):
        ...     '''First tool with specific resource needs'''
        ...     return {"output": "result_a"}
        >>>
        >>> @ray.remote(num_cpus=8, memory=4 * 1024**3)
        >>> def tool_b(param: dict):
        ...     '''Second tool with different resource needs'''
        ...     return {"output": "result_b"}
        >>>
        >>> # Create adapter with any LangChain LLM
        >>> llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.7)
        >>> adapter = LangChainAdapter(llm=llm)
        >>>
        >>> # Use with AgentSession for stateful conversations
        >>> from ray_agents import AgentSession
        >>> session = AgentSession.remote("user_id", adapter=adapter)
        >>> result = ray.get(session.run.remote(
        ...     "Use the available tools to help me",
        ...     tools=[tool_a, tool_b]
        ... ))

    Works with any LangChain LLM provider (ChatOpenAI, ChatAnthropic, etc.).

    **DeveloperAPI:** This API may change across minor Ray releases.
    """

    def __init__(
        self,
        llm: Any,
        system_prompt: str | None = None,
    ):
        """
        Initialize LangChain agent adapter.

        Args:
            llm: Pre-configured LangChain LLM (ChatOpenAI, ChatAnthropic, etc.)
                 User has full control over model, temperature, API keys, etc.
            system_prompt: Optional system prompt for the agent

        Example:
            >>> from langchain_openai import ChatOpenAI
            >>> llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.7)
            >>> adapter = LangChainAdapter(llm=llm)
        """
        self.llm = llm
        self.system_prompt = system_prompt or "You are a helpful AI assistant."
        self._agent: Any | None = None
        self._cached_tool_signature: tuple | None = None

        logger.info(
            f"Initialized LangChainAdapter: llm={type(llm).__name__}, "
            f"system_prompt={system_prompt[:50] if system_prompt else 'default'}..."
        )

    async def run(
        self, message: str, messages: list[dict], tools: list[Any]
    ) -> dict[str, Any]:
        """
        Execute LangChain agent with Ray distributed tools.

        Flow:
        1. Convert Ray remote functions → LangChain Tool format
        2. Create LangChain agent with create_agent()
        3. Agent executes its ReAct loop (decides which tools to call)
        4. When tool is called, Ray executes it distributed
        5. LangChain generates final response

        Args:
            message: Current user message
            messages: Conversation history
            tools: List of Ray remote functions

        Returns:
            Response dict with 'content' key and metadata
        """
        logger.debug(
            f"LangChain adapter processing message with {len(tools)} available tools"
        )

        try:
            langchain_tools = self._wrap_ray_tools_for_langchain(tools)
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

    def _wrap_ray_tools_for_langchain(self, ray_tools: list[Any]) -> list[Callable]:
        """
        Wrap Ray remote functions as LangChain-compatible callables.

        This is the key integration point: when LangChain calls these tools,
        they execute as Ray tasks (distributed across cluster).

        Note: Tools execute sequentially. LangChain's create_agent does not
        support async/parallel tool calls.

        Args:
            ray_tools: List of Ray remote functions

        Returns:
            List of callables that LangChain can use as tools
        """
        wrapped_tools = []

        for ray_tool in ray_tools:
            if hasattr(ray_tool, "_remote_func") and hasattr(ray_tool, "args_schema"):
                wrapped_tools.append(ray_tool)
                logger.debug(
                    f"Using from_langchain_tool wrapper directly: {ray_tool.__name__}"
                )
                continue
            elif hasattr(ray_tool, "remote"):
                remote_func = ray_tool
            elif hasattr(ray_tool, "_remote_func"):
                remote_func = ray_tool._remote_func
            else:
                logger.warning(
                    f"Tool {ray_tool} is not a Ray remote function, skipping"
                )
                continue

            def make_wrapper(tool, original_tool):
                """Create wrapper that preserves signature for LangChain."""
                if hasattr(tool, "_function"):
                    original_func = tool._function
                elif hasattr(original_tool, "__name__"):
                    original_func = original_tool
                else:
                    original_func = tool

                @functools.wraps(original_func)
                def sync_wrapper(*args, **kwargs):
                    logger.info(
                        f"Executing {original_func.__name__}: "
                        f"args={args}, kwargs={kwargs}"
                    )

                    object_ref = tool.remote(*args, **kwargs)
                    result = ray.get(object_ref)

                    if isinstance(result, dict) and "status" in result:
                        if result["status"] == "error":
                            error_msg = result.get("error", "Unknown error")
                            raise RuntimeError(f"Tool error: {error_msg}")
                        if "result" in result:
                            result = result["result"]

                    logger.info(
                        f"Completed {original_func.__name__}: {result[:200] if isinstance(result, str) else result}"
                    )
                    return result

                return sync_wrapper

            wrapped_tools.append(make_wrapper(remote_func, ray_tool))

        logger.debug(f"Wrapped {len(wrapped_tools)} Ray tools for LangChain")
        return wrapped_tools

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
            logger.info(
                f"Creating new agent (tools changed: {self._cached_tool_signature} -> {tool_signature})"
            )
            from langchain.agents import create_agent

            self._agent = create_agent(self.llm, tools=lc_tools)
            self._cached_tool_signature = tool_signature
            logger.info("LangChain agent created successfully")
        else:
            logger.debug("Reusing cached agent (tools unchanged)")

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
            from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

            conversation_history = [SystemMessage(content=self.system_prompt)]

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
                    tool_kwargs = {
                        "func": wrapped_tool,
                        "name": wrapped_tool.__name__,
                        "description": wrapped_tool.__doc__
                        or f"Calls {wrapped_tool.__name__}",
                    }
                    if hasattr(wrapped_tool, "args_schema"):
                        tool_kwargs["args_schema"] = wrapped_tool.args_schema

                    structured_tool = StructuredTool.from_function(**tool_kwargs)
                    logger.info(
                        f"Created tool: {structured_tool.name} - "
                        f"{structured_tool.description[:80]}..."
                    )
                    lc_tools.append(structured_tool)
                except Exception as e:
                    logger.error(
                        f"Failed to create tool from {wrapped_tool.__name__}: {e}",
                        exc_info=True,
                    )

            if not lc_tools:
                raise ValueError("No tools could be created")

            logger.info(f"Created {len(lc_tools)} LangChain tools for agent")

            agent = self._get_or_create_agent(lc_tools)

            try:
                result = await agent.ainvoke({"messages": conversation_history})

                logger.info(
                    f"Agent execution complete. Result has {len(result['messages'])} messages"
                )

                final_message = result["messages"][-1]
                return str(final_message.content)

            except Exception as e:
                logger.error(f"Error during agent execution: {e}", exc_info=True)
                raise

        except Exception as e:
            logger.error(f"Error in LangChain execution: {e}")
            raise
