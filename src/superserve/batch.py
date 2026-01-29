"""Generic batch tool for parallel execution of any registered tool."""

from collections.abc import Callable
from typing import Any

import ray
from pydantic import BaseModel, Field


class BatchToolInput(BaseModel):
    """Input schema for batch tool."""

    tool_name: str = Field(description="Name of the tool to execute")
    tool_inputs: list[dict[str, Any]] = Field(
        description="List of input dictionaries, one per tool invocation"
    )


class BatchToolOutput(BaseModel):
    """Output schema for batch tool results."""

    results: list[Any] = Field(
        description="Results from each tool invocation (None if error occurred)"
    )
    errors: list[str | None] = Field(
        description="Error messages for each invocation (None if success)"
    )
    tool_name: str = Field(description="Name of the tool that was executed")
    count: int = Field(description="Number of inputs processed")


def batch_tool(
    tools: list[Callable],
    name: str = "batch",
    description: str | None = None,
) -> Callable[[str, list[dict[str, Any]]], dict[str, Any]]:
    """Create a batch tool function for parallel execution of registered tools.

    Returns a plain function that works with any agent framework. When called by an LLM, it:
    1. Resolves the tool by name
    2. Executes all inputs in parallel on Ray
    3. Returns structured output with results

    Args:
        tools: List of tools to register (names inferred from __name__)
        name: Name for the batch tool (default: "batch")
        description: Custom description for the batch tool

    Returns:
        A callable function that can be passed to any agent framework.

    Example:
        >>> wiki_batch = batch_tool(tools=[wikipedia], name="wiki_batch")
        >>> agent = Agent(..., tools=[wiki_batch])
        >>>
        >>> # The LLM can then call:
        >>> result = wiki_batch(
        ...     tool_name="wikipedia",
        ...     tool_inputs=[{"query": "Python"}, {"query": "Rust"}]
        ... )
    """
    tool_registry: dict[str, Callable] = {}
    remote_funcs: dict[str, Any] = {}

    for tool in tools:
        if hasattr(tool, "_original_func"):
            tool_name = tool._original_func.__name__
        elif hasattr(tool, "__name__"):
            tool_name = tool.__name__
        else:
            raise ValueError(f"Cannot infer tool name for {tool}, provide explicitly")

        tool_registry[tool_name] = tool

        # Get or create the ray remote function
        if hasattr(tool, "_get_remote_func"):
            # Already a @superserve.tool decorated function (lazy init)
            remote_funcs[tool_name] = tool._get_remote_func()
        elif hasattr(tool, "_original_func"):
            # Decorated tool - use original function
            remote_funcs[tool_name] = ray.remote(tool._original_func)
        else:
            # Plain callable - wrap with ray.remote
            remote_funcs[tool_name] = ray.remote(tool)

    available_tools = list(tool_registry.keys())

    default_description = (
        f"Execute multiple calls to any registered tool in parallel. "
        f"Available tools: {available_tools}. "
        f"Provide the tool name and a list of input dictionaries. "
        f"Returns results and any errors for each input."
    )
    tool_description = description or default_description

    def batch(tool_name: str, tool_inputs: list[dict[str, Any]]) -> dict[str, Any]:
        """Execute batch tool calls in parallel.

        Args:
            tool_name: Name of tool to execute
            tool_inputs: List of input dicts for each invocation

        Returns:
            Dict with results, errors, tool_name, count
        """
        if not tool_inputs:
            return BatchToolOutput(
                results=[],
                errors=[],
                tool_name=tool_name,
                count=0,
            ).model_dump()

        if tool_name not in remote_funcs:
            error_msg = f"Tool '{tool_name}' not found. Available: {available_tools}"
            return BatchToolOutput(
                results=[None] * len(tool_inputs),
                errors=[error_msg] * len(tool_inputs),
                tool_name=tool_name,
                count=len(tool_inputs),
            ).model_dump()

        remote_func = remote_funcs[tool_name]
        refs = [remote_func.remote(**inp) for inp in tool_inputs]

        results: list[Any] = []
        errors: list[str | None] = []

        for i, ref in enumerate(refs):
            try:
                result = ray.get(ref)
                results.append(result)
                errors.append(None)
            except Exception as e:
                results.append(None)
                errors.append(f"Execution error for input {i}: {str(e)}")

        return BatchToolOutput(
            results=results,
            errors=errors,
            tool_name=tool_name,
            count=len(tool_inputs),
        ).model_dump()

    batch.__name__ = name
    batch.__qualname__ = name
    batch.__doc__ = tool_description
    batch.__annotations__ = {
        "tool_name": str,
        "tool_inputs": list[dict[str, Any]],
        "return": dict[str, Any],
    }

    return batch


BatchTool = batch_tool

__all__ = ["batch_tool", "BatchTool", "BatchToolInput", "BatchToolOutput"]
