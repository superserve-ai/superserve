from abc import ABC, abstractmethod
from typing import Any

from ray.util.annotations import DeveloperAPI


@DeveloperAPI
class AgentAdapter(ABC):
    """
    Base adapter for agent frameworks.

    Subclass this to integrate Ray Agents with different agent frameworks
    (LangGraph, CrewAI, Autogen, PydanticAI, etc.). The adapter wraps the
    framework's native execution while enabling Ray's distributed runtime
    for tool execution.

    The framework maintains full control over:
    - Which tools to call
    - Execution order (parallel vs sequential)
    - Agent reasoning and state management

    Ray provides:
    - Distributed tool execution across cluster
    - Resource heterogeneity (GPU, CPU, memory)
    - Fault tolerance and retries

    Args:
        None (subclasses define their own initialization)

    Example:
        >>> class MyFrameworkAdapter(AgentAdapter):
        ...     async def run(self, message, messages, tools) -> Dict[str, Any]:
        ...         # Convert Ray tools to framework format
        ...         framework_tools = self._wrap_ray_tools(tools)
        ...
        ...         # Let framework execute (calls Ray tools under the hood)
        ...         result = self.framework.execute(message, framework_tools)
        ...
        ...         return {"content": result}

    **DeveloperAPI:** This API may change across minor Ray releases.
    """

    @abstractmethod
    async def run(
        self, message: str, messages: list[dict], tools: list[Any]
    ) -> dict[str, Any]:
        """
        Execute agent reasoning loop.

        This method should:
        1. Convert Ray remote functions to framework-specific tool format
        2. Let the framework execute its native flow
        3. Return response in standard format

        The framework handles all decision-making. Ray tools are executed
        distributed when the framework calls them.

        Args:
            message: Current user message
            messages: Full conversation history (list of dicts with 'role' and 'content')
            tools: List of Ray remote functions available for use

        Returns:
            Response dictionary with at least a 'content' key containing the
            agent's response. May include additional metadata.

        Example:
            >>> response = await adapter.run(
            ...     message="Search web and process data",
            ...     messages=[],
            ...     tools=[search_web, process_data]
            ... )
            >>> print(response["content"])
        """
        pass
