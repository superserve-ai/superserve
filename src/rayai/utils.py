"""Utility functions for ray-agents."""

from collections.abc import Callable
from typing import Any

import ray


def execute_tools(
    tool_calls: list[tuple[Callable, dict[str, Any]]],
    parallel: bool = False,
) -> list[Any]:
    """Execute multiple tools sequentially or in parallel.

    Args:
        tool_calls: List of (tool_function, args_dict) tuples
        parallel: If True, execute in parallel using Ray (default: False)

    Returns:
        List of results in same order as tool_calls
    """
    if not parallel:
        return [tool(**args) for tool, args in tool_calls]

    futures = []
    for tool, args in tool_calls:
        if not hasattr(tool, "_remote_func"):
            raise ValueError(
                f"Tool {tool.__name__} is not decorated with @tool. "
                "Only @tool decorated functions can be executed in parallel."
            )
        future = tool._remote_func.remote(**args)
        futures.append(future)

    return ray.get(futures)
