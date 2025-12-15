"""Converter for Pydantic AI tools to Ray-executed tools."""

import inspect
from collections.abc import Callable
from typing import Any

import ray


def from_pydantic_tool(
    pydantic_tool: Any,
    num_cpus: int = 1,
    memory: int | float = 256 * 1024**2,
    num_gpus: int = 0,
) -> Callable:
    """Wrap a Pydantic AI Tool to execute on Ray workers.

    Returns a function that can be used directly with Pydantic AI agents.
    The tool's execution is distributed to Ray workers with the specified resources.

    Args:
        pydantic_tool: Pydantic AI Tool instance (from pydantic_ai.Tool)
        num_cpus: Number of CPUs to allocate (default: 1)
        memory: Memory to allocate in bytes (int) or GB (float < 1024)
        num_gpus: Number of GPUs to allocate (default: 0)

    Returns:
        Function that executes on Ray workers, usable with Pydantic AI agents

    Raises:
        ImportError: If pydantic-ai is not installed
        ValueError: If tool is not a Pydantic AI Tool instance

    Example:
        ```python
        from pydantic_ai import Agent, Tool
        from rayai.adapters import from_pydantic_tool

        def get_weather(city: str) -> str:
            '''Get the current weather for a city.'''
            return f"Weather in {city}: Sunny, 72°F"

        weather_tool = Tool(get_weather, name="weather", description="Get weather")

        # Wrap for Ray execution
        ray_weather = from_pydantic_tool(weather_tool, num_cpus=1)

        # Use directly with Pydantic AI agent
        agent = Agent("openai:gpt-4o-mini", tools=[ray_weather])
        ```
    """
    try:
        from pydantic_ai import Tool
    except ImportError:
        raise ImportError(
            "Pydantic AI tool conversion requires 'pydantic-ai'. "
            "Install with: pip install pydantic-ai"
        ) from None

    if not isinstance(pydantic_tool, Tool):
        raise ValueError(
            f"Expected Pydantic AI Tool instance, got {type(pydantic_tool).__name__}. "
            "For plain functions, use the @tool decorator from rayai instead."
        )

    func = pydantic_tool.function
    tool_name = pydantic_tool.name or func.__name__
    tool_description = pydantic_tool.description or func.__doc__ or ""

    if isinstance(memory, float) and memory < 1024:
        memory_bytes = int(memory * (1024**3))
    else:
        memory_bytes = int(memory)

    # Create Ray remote function
    @ray.remote(num_cpus=num_cpus, memory=memory_bytes, num_gpus=num_gpus)
    def _execute_tool(**kwargs: Any) -> Any:
        return func(**kwargs)  # type: ignore[call-arg]

    # Create wrapper function that Pydantic AI can use directly
    def ray_wrapper(**kwargs: Any) -> Any:
        """Execute tool on Ray worker."""
        return ray.get(_execute_tool.remote(**kwargs))

    # Preserve metadata for Pydantic AI tool registration
    ray_wrapper.__name__ = tool_name
    ray_wrapper.__qualname__ = tool_name
    ray_wrapper.__doc__ = tool_description

    # Preserve type annotations and signature for Pydantic AI schema generation
    if hasattr(func, "__annotations__"):
        ray_wrapper.__annotations__ = func.__annotations__

    try:
        ray_wrapper.__signature__ = inspect.signature(func)  # type: ignore[attr-defined]
    except (ValueError, TypeError):
        pass

    return ray_wrapper
