import functools
import logging
from collections.abc import Callable
from typing import Any

import ray
from ray.util.annotations import DeveloperAPI

from ray_agents.adapters.abc import AgentAdapter

logger = logging.getLogger(__name__)


@DeveloperAPI
class LangGraphAdapter(AgentAdapter):
    """
    Adapter for LangGraph agents with Ray distributed tool execution.

    This adapter wraps LangGraph's native execution (ReAct pattern, tool calling,
    state management) while executing tools as Ray tasks. LangGraph maintains
    full control over the agent flow; Ray provides distributed execution.

    When LangGraph calls a tool, it's actually executing:
        result = ray.get(tool.remote(**args))

    This means tools automatically run on cluster nodes with appropriate resources.

    Example:
        >>> from ray.agentic.experimental.adapters import LangGraphAdapter
        >>>
        >>> # Define tools with resource requirements
        >>> @ray.remote(num_gpus=1)
        >>> def generate_image(prompt: str):
        ...     '''Generate an image using Stable Diffusion'''
        ...     return "image.png"
        >>>
        >>> @ray.remote(num_cpus=16)
        >>> def process_data(file: str):
        ...     '''Process large CSV file'''
        ...     return {"rows": 1000000}
        >>>
        >>> # Create adapter - LangGraph decides tool calling strategy
        >>> adapter = LangGraphAdapter(
        ...     model="gpt-4o-mini",
        ...     parallel_tool_calls=True
        ... )
        >>>
        >>> # Tools execute distributed when LangGraph calls them
        >>> session = AgentSession.remote("user", adapter)
        >>> result = session.run.remote(
        ...     "Generate image and process data.csv",
        ...     tools=[generate_image, process_data]
        ... )

    **DeveloperAPI:** This API may change across minor Ray releases.
    """

    def __init__(
        self,
        model: str = "gpt-4o-mini",
        system_prompt: str | None = None,
        parallel_tool_calls: bool = True,
    ):
        """
        Initialize LangGraph adapter.

        Args:
            model: LLM model name (e.g., "gpt-4o", "gpt-4o-mini")
            system_prompt: Optional system prompt for the agent
            parallel_tool_calls: Whether to allow LLM to request parallel tool execution
        """
        self.model = model
        self.system_prompt = system_prompt or "You are a helpful AI assistant."
        self.parallel_tool_calls = parallel_tool_calls
        self._llm: Any | None = None

        logger.info(
            f"Initialized LangGraphAdapter: model={model}, "
            f"parallel_tool_calls={parallel_tool_calls}"
        )

    def _init_llm(self):
        """Initialize LLM (lazy to make dependency optional)."""
        if self._llm is not None:
            return

        try:
            from langchain_openai import ChatOpenAI

            self._llm = ChatOpenAI(model=self.model, temperature=0.7)
            logger.debug("LLM initialized successfully")
        except ImportError as e:
            raise ImportError(
                "LangGraph adapter requires 'langchain-openai'. "
                "Install with: pip install langchain-openai"
            ) from e

    async def run(
        self, message: str, messages: list[dict], tools: list[Any]
    ) -> dict[str, Any]:
        """
        Execute LangGraph agent with Ray distributed tools.

        Flow:
        1. Convert Ray remote functions → LangGraph Tool format
        2. LangGraph executes its ReAct loop (decides which tools to call)
        3. When tool is called, Ray executes it distributed
        4. LangGraph generates final response

        Args:
            message: Current user message
            messages: Conversation history
            tools: List of Ray remote functions

        Returns:
            Response dict with 'content' key and metadata
        """
        self._init_llm()

        logger.debug(
            f"LangGraph adapter processing message with {len(tools)} available tools"
        )

        try:
            langgraph_tools = self._wrap_ray_tools_for_langgraph(tools)
            response_text = await self._simple_execute(message, langgraph_tools)

            return {
                "content": response_text,
                "tools_available": len(tools),
                "model": self.model,
            }

        except Exception as e:
            logger.error(f"Error in LangGraph adapter: {e}")
            raise

    def _wrap_ray_tools_for_langgraph(self, ray_tools: list[Any]) -> list[Callable]:
        """
        Wrap Ray remote functions as LangGraph-compatible callables.

        This is the key integration point: when LangGraph calls these tools,
        they execute as Ray tasks (distributed across cluster).

        Args:
            ray_tools: List of Ray remote functions

        Returns:
            List of callables that LangGraph can use as tools
        """
        wrapped_tools = []

        for ray_tool in ray_tools:
            if not hasattr(ray_tool, "remote"):
                logger.warning(
                    f"Tool {ray_tool} is not a Ray remote function, skipping"
                )
                continue

            def make_wrapper(tool):
                """Create wrapper that preserves signature for LangChain."""
                original_func = tool._function if hasattr(tool, "_function") else tool

                @functools.wraps(original_func)
                def wrapper(*args, **kwargs):
                    """Execute tool via Ray."""
                    logger.debug(
                        f"Executing {original_func.__name__}: "
                        f"args={args}, kwargs={kwargs}"
                    )
                    result = ray.get(tool.remote(*args, **kwargs))
                    logger.debug(f"Completed {original_func.__name__}: {result}")
                    return result

                return wrapper

            wrapped_tools.append(make_wrapper(ray_tool))

        logger.debug(f"Wrapped {len(wrapped_tools)} Ray tools for LangGraph")
        return wrapped_tools

    async def _simple_execute(self, message: str, tools: list[Callable]) -> str:
        """
        Execute LangGraph agent with tool calling.

        Uses LangGraph's create_react_agent to enable real tool calling
        with the LLM deciding which tools to invoke.

        Args:
            message: User message
            tools: Wrapped tools (execute via Ray when called)

        Returns:
            Response text from agent
        """
        try:
            from langchain_core.messages import HumanMessage, SystemMessage

            # If no tools, just do a simple LLM call
            if not tools:
                assert self._llm is not None, "LLM must be initialized"
                llm_messages = [
                    SystemMessage(content=self.system_prompt),
                    HumanMessage(content=message),
                ]
                response = await self._llm.ainvoke(llm_messages)
                return str(response.content)

            # With tools: use LangGraph's ReAct agent for tool calling
            try:
                from langgraph.prebuilt import create_react_agent
            except ImportError as e:
                raise ImportError(
                    "LangGraph agent requires 'langgraph'. "
                    "Install with: pip install langgraph"
                ) from e

            from langchain_core.tools import StructuredTool

            lc_tools = []
            for wrapped_tool in tools:
                try:
                    decorated = StructuredTool.from_function(
                        func=wrapped_tool,
                        name=wrapped_tool.__name__,
                        description=wrapped_tool.__doc__
                        or f"Calls {wrapped_tool.__name__}",
                    )
                    logger.info(
                        f"Created tool: {decorated.name} - {decorated.description[:80]}..."
                    )
                    logger.info(f"Tool schema: {decorated.args}")
                    lc_tools.append(decorated)
                except Exception as e:
                    logger.error(
                        f"Failed to create tool from {wrapped_tool.__name__}: {e}",
                        exc_info=True,
                    )

            if not lc_tools:
                raise ValueError("No tools could be created")

            logger.info(f"Created {len(lc_tools)} LangChain tools for agent")

            # Create ReAct agent with tools
            assert self._llm is not None, "LLM must be initialized"
            agent = create_react_agent(self._llm, lc_tools)
            logger.info("ReAct agent created successfully")

            # Execute agent
            try:
                result = await agent.ainvoke(
                    {
                        "messages": [
                            SystemMessage(content=self.system_prompt),
                            HumanMessage(content=message),
                        ]
                    }
                )

                logger.info(
                    f"Agent execution complete. Result has {len(result['messages'])} messages"
                )

                # Log all messages for debugging
                for i, msg in enumerate(result["messages"]):
                    msg_type = type(msg).__name__
                    logger.debug(f"Message {i}: {msg_type}")
                    if hasattr(msg, "tool_calls") and msg.tool_calls:
                        logger.info(f"Tool calls in message {i}: {msg.tool_calls}")

                # Extract final response
                final_message = result["messages"][-1]
                return str(final_message.content)

            except Exception as e:
                logger.error(f"Error during agent execution: {e}", exc_info=True)
                raise

        except Exception as e:
            logger.error(f"Error in LangGraph execution: {e}")
            raise
