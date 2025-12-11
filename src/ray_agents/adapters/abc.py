"""Tool adapter for agent frameworks."""

import functools
import logging
from collections.abc import Callable
from enum import Enum
from typing import Any

import ray

logger = logging.getLogger(__name__)


class AgentFramework(Enum):
    """Supported agent frameworks."""

    LANGCHAIN = "langchain"
    PYDANTIC = "pydantic"


class ToolAdapter:
    """
    Adapter for wrapping Ray tools for use with agent frameworks.

    Wraps Ray remote functions as framework-compatible callables.
    The adapter only handles tool wrapping - users manage their own
    agents and conversation history.

    Example:
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)
        wrapped_tools = adapter.wrap_tools(ray_tools)

        # User manages their own agent
        agent = create_react_agent(llm, wrapped_tools)
        result = await agent.ainvoke({"messages": my_history})
    """

    def __init__(self, framework: AgentFramework):
        """
        Initialize tool adapter.

        Args:
            framework: Target agent framework for tool wrapping
        """
        self.framework = framework

    def wrap_tools(self, ray_tools: list[Any]) -> list[Callable]:
        """
        Wrap Ray remote functions as framework-compatible callables.

        Args:
            ray_tools: List of Ray remote functions (from @tool decorator
                      or from_langchain_tool())

        Returns:
            List of wrapped callables compatible with the target framework
        """
        wrapped_tools = []

        for ray_tool in ray_tools:
            if hasattr(ray_tool, "remote"):
                remote_func = ray_tool
            elif hasattr(ray_tool, "_remote_func"):
                remote_func = ray_tool._remote_func
            else:
                logger.warning(
                    f"Tool {ray_tool} is not a Ray remote function, skipping"
                )
                continue

            wrapped_tools.append(self._make_tool_wrapper(remote_func, ray_tool))

        return wrapped_tools

    def _make_tool_wrapper(self, tool: Any, original_tool: Any) -> Callable:
        """
        Create a sync wrapper for a Ray remote tool.

        The wrapper executes the tool on Ray and handles error status dicts.

        Args:
            tool: Ray remote function to wrap
            original_tool: Original tool for preserving metadata

        Returns:
            Sync callable that dispatches to Ray
        """
        if hasattr(tool, "_function"):
            original_func = tool._function
        elif hasattr(original_tool, "__name__"):
            original_func = original_tool
        else:
            original_func = tool

        @functools.wraps(original_func)
        def sync_wrapper(*args, **kwargs):
            object_ref = tool.remote(*args, **kwargs)
            result = ray.get(object_ref)

            if isinstance(result, dict) and "status" in result:
                if result["status"] == "error":
                    error_msg = result.get("error", "Unknown error")
                    raise RuntimeError(f"Tool error: {error_msg}")
                if "result" in result:
                    result = result["result"]

            return result

        # Preserve args_schema for LLM tool specifications
        if hasattr(original_tool, "args_schema"):
            sync_wrapper.args_schema = original_tool.args_schema  # type: ignore[attr-defined]

        return sync_wrapper
