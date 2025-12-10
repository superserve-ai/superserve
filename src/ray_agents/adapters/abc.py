"""Base adapter for agent frameworks."""

import functools
import logging
from abc import ABC, abstractmethod
from collections.abc import Callable
from enum import Enum
from typing import Any, ClassVar

import ray

logger = logging.getLogger(__name__)


class AgentFramework(Enum):
    """Supported agent frameworks."""

    LANGCHAIN = "langchain"
    PYDANTIC = "pydantic"


class AgentAdapter(ABC):
    """
    Base adapter for agent frameworks.

    Subclass this to integrate Agentic-Ray with different agent frameworks.
    The adapter wraps the framework's native execution while enabling Ray's
    distributed runtime for tool execution.

    Subclasses must define a `framework` class attribute with a valid
    AgentFramework enum value.

    **DeveloperAPI:** This API may change across minor Ray releases.
    """

    framework: ClassVar[AgentFramework]

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if ABC not in cls.__bases__ and not getattr(cls, "__abstractmethods__", None):
            if not hasattr(cls, "framework") or not isinstance(
                cls.framework, AgentFramework
            ):
                raise TypeError(
                    f"{cls.__name__} must define 'framework' class attribute "
                    f"with a valid AgentFramework enum value"
                )

    def _wrap_ray_tools(self, ray_tools: list[Any]) -> list[Callable]:
        """
        Wrap Ray remote functions as framework-compatible callables.

        Uses self.framework to apply framework-specific wrapping logic.

        Args:
            ray_tools: List of Ray remote functions

        Returns:
            List of wrapped callables compatible with the framework
        """
        wrapped_tools = []

        for ray_tool in ray_tools:
            if hasattr(ray_tool, "_remote_func") and hasattr(ray_tool, "args_schema"):
                if self.framework == AgentFramework.LANGCHAIN:
                    wrapped_tools.append(ray_tool)
                    continue

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
        """Create a sync wrapper for a Ray remote tool."""
        if hasattr(tool, "_function"):
            original_func = tool._function
        elif hasattr(original_tool, "__name__"):
            original_func = original_tool
        else:
            original_func = tool

        match self.framework:
            case AgentFramework.LANGCHAIN | AgentFramework.PYDANTIC:
                return self._make_wrapper_with_error_handling(tool, original_func)

    def _make_wrapper_with_error_handling(
        self, tool: Any, original_func: Any
    ) -> Callable:
        """Wrapper that checks for error status in result dict."""

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

        return sync_wrapper

    @abstractmethod
    async def run(
        self, message: str, messages: list[dict], tools: list[Any]
    ) -> dict[str, Any]:
        """
        Execute agent reasoning loop.

        Args:
            message: Current user message
            messages: Full conversation history (list of dicts with 'role' and 'content')
            tools: List of Ray remote functions available for use

        Returns:
            Response dictionary with at least a 'content' key containing the
            agent's response. May include additional metadata.
        """
        pass
