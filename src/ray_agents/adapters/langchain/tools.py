"""Converter for LangChain tools to Ray-compatible tools."""

from collections.abc import Callable
from typing import Any

import ray


def from_langchain_tool(
    langchain_tool: Any,
    num_cpus: int = 1,
    memory: int | float = 256 * 1024**2,
    num_gpus: int = 0,
) -> Callable:
    """Convert a LangChain tool to a Ray-compatible remote function.

    Args:
        langchain_tool: LangChain tool (BaseTool instance)
        num_cpus: Number of CPUs to allocate (default: 1)
        memory: Memory to allocate in bytes (int) or GB (float < 1024)
        num_gpus: Number of GPUs to allocate (default: 0)

    Returns:
        Ray remote function compatible with RayAgent.register_tools()

    Raises:
        ImportError: If langchain-core is not installed
        ValueError: If tool is not a LangChain BaseTool
    """
    try:
        from langchain_core.tools import BaseTool
    except ImportError:
        raise ImportError(
            "LangChain tool conversion requires 'langchain-core'. "
            "Install with: pip install langchain-core"
        ) from None

    if not isinstance(langchain_tool, BaseTool):
        raise ValueError(
            f"Expected LangChain BaseTool, got {type(langchain_tool).__name__}"
        )

    tool_name = langchain_tool.name
    tool_description = langchain_tool.description

    if isinstance(memory, float) and memory < 1024:
        memory_bytes = int(memory * (1024**3))
    else:
        memory_bytes = int(memory)

    def _normalize_input(kwargs: dict[str, Any]) -> str | dict[str, Any]:
        """Normalize kwargs to format expected by LangChain tools."""
        if len(kwargs) == 1:
            return next(iter(kwargs.values()))  # type: ignore[no-any-return]
        elif len(kwargs) == 0:
            return ""
        else:
            return kwargs

    def create_wrapper(lc_tool: Any, name: str) -> Callable:
        """Factory function to create a wrapper that preserves the tool's name and description."""

        def wrapper(**kwargs: Any) -> dict[str, Any]:
            try:
                tool_input = _normalize_input(kwargs)
                result = lc_tool.invoke(tool_input)
                return {
                    "result": result,
                    "status": "success",
                    "tool": name,
                }
            except Exception as e:
                return {
                    "error": str(e),
                    "status": "error",
                    "tool": name,
                }

        async def async_wrapper(**kwargs: Any) -> dict[str, Any]:
            """Async version for LangGraph compatibility."""
            try:
                tool_input = _normalize_input(kwargs)
                result = await lc_tool.ainvoke(tool_input)
                return {
                    "result": result,
                    "status": "success",
                    "tool": name,
                }
            except Exception as e:
                return {
                    "error": str(e),
                    "status": "error",
                    "tool": name,
                }

        wrapper.__name__ = name
        wrapper.__qualname__ = name
        wrapper.__doc__ = lc_tool.description
        wrapper._async = async_wrapper  # type: ignore[attr-defined]
        return wrapper

    tool_wrapper = create_wrapper(langchain_tool, tool_name)

    ray_remote_func = ray.remote(
        num_cpus=num_cpus,
        memory=memory_bytes,
        num_gpus=num_gpus,
    )(tool_wrapper)

    def sync_wrapper(**kwargs: Any) -> dict[str, Any]:
        """Synchronous wrapper that executes the Ray remote function."""
        return ray.get(ray_remote_func.remote(**kwargs))  # type: ignore[no-any-return]

    async def async_wrapper(**kwargs: Any) -> dict[str, Any]:
        """Async wrapper that enables parallel execution."""
        object_ref = ray_remote_func.remote(**kwargs)
        return await object_ref  # type: ignore[no-any-return]

    sync_wrapper.__name__ = tool_name
    sync_wrapper.__doc__ = tool_description
    sync_wrapper._remote_func = ray_remote_func  # type: ignore[attr-defined]
    sync_wrapper._async = async_wrapper  # type: ignore[attr-defined]

    if (
        hasattr(langchain_tool, "args_schema")
        and langchain_tool.args_schema is not None
    ):
        sync_wrapper.args_schema = langchain_tool.args_schema  # type: ignore[attr-defined]
        async_wrapper.args_schema = langchain_tool.args_schema  # type: ignore[attr-defined]

    return sync_wrapper
