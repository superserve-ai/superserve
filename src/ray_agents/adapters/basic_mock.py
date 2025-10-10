from typing import Any

import ray
from ray.util.annotations import DeveloperAPI

from ray_agents.adapters.abc import AgentAdapter


@DeveloperAPI
class _MockAdapter(AgentAdapter):
    """
    Simple mock adapter for testing and examples.

    This adapter executes all provided Ray remote tools and returns
    a mock response. Primarily used for testing the Ray Agentic framework.

    Example:
        >>> adapter = _MockAdapter()
        >>> session = AgentSession.remote("test", adapter)
        >>> result = session.run.remote("Hello", tools=[my_tool])

    **DeveloperAPI:** This API may change across minor Ray releases.
    """

    async def run(
        self, message: str, messages: list[dict], tools: list[Any]
    ) -> dict[str, Any]:
        """Execute mock agent logic with tool execution."""
        tool_results = []
        if tools:
            for tool in tools:
                # Handle both bound and unbound Ray remote functions
                if hasattr(tool, "execute"):
                    # Bound tool (created with .bind())
                    result = ray.get(tool.execute())
                    tool_results.append(result)
                elif hasattr(tool, "remote"):
                    # Unbound tool (needs to be called with .remote())
                    result = ray.get(tool.remote())
                    tool_results.append(result)

        response = f"Mock response to: {message}"
        if tool_results:
            response += f" (with {len(tool_results)} tool results)"

        return {"content": response, "tool_results": tool_results}
