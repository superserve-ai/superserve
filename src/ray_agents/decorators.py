"""Decorators for Ray agents."""

from collections.abc import Callable
from typing import Any

import ray

from ray_agents.resource_loader import _parse_memory


def tool(
    desc: str = "",
    num_cpus: int = 1,
    num_gpus: int = 0,
    memory: str | None = None,
) -> Callable:
    """Convert function to directly callable tool that executes on Ray.

    Args:
        desc: Tool description for LLM schema generation
        num_cpus: Number of CPU cores required (default: 1)
        num_gpus: Number of GPUs required (default: 0)
        memory: Memory requirement as string (e.g., "4GB", "512MB")

    Returns:
        Decorated function that executes on Ray with specified resources
    """

    def decorator(func: Callable) -> Any:
        ray_options: dict[str, Any] = {
            "num_cpus": num_cpus,
            "num_gpus": num_gpus,
        }
        if memory:
            ray_options["memory"] = _parse_memory(memory)

        remote_func = ray.remote(**ray_options)(func)

        def sync_wrapper(*args, **kwargs) -> Any:
            """
            Synchronous wrapper that executes tool on Ray and waits for result.

            This hides Ray internals (.remote() and ray.get()) from users.
            """
            return ray.get(remote_func.remote(*args, **kwargs))

        sync_wrapper._tool_metadata = {  # type: ignore[attr-defined]
            "description": desc or func.__doc__ or f"Calls {func.__name__}",
            "num_cpus": num_cpus,
            "num_gpus": num_gpus,
            "memory": memory,
        }

        sync_wrapper._original_func = func  # type: ignore[attr-defined]
        sync_wrapper._remote_func = remote_func  # type: ignore[attr-defined]

        sync_wrapper.__name__ = func.__name__
        sync_wrapper.__doc__ = func.__doc__

        return sync_wrapper

    return decorator
