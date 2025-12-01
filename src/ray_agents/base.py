"""Base classes for Agentic-Ray framework."""

from abc import ABC, abstractmethod
from typing import Any


class RayAgent(ABC):
    """Abstract base class for all Agentic-Ray agents.

    Agents must implement the run() method and register tools using
    the register_tools() method in __init__().
    """

    def __init__(self):  # noqa: B027
        """Initialize the agent. Subclasses should call super().__init__()."""
        self._registered_tools: list[Any] = []

    def register_tools(self, *tools: Any) -> None:
        """Register tools at runtime.

        Args:
            *tools: Variable number of @tool decorated functions
        """
        self._registered_tools.extend(tools)

    def get_tools(self) -> list[Any]:
        """Get all registered tools for this agent.

        Returns:
            List of @tool decorated Ray remote functions
        """
        return list(self._registered_tools)

    def execute_tools(
        self,
        tool_calls: list[tuple[Any, dict[str, Any]]],
        parallel: bool = False,
    ) -> list[Any]:
        """Execute multiple tools sequentially or in parallel.

        Args:
            tool_calls: List of (tool_function, args_dict) tuples
            parallel: If True, execute in parallel using Ray (default: False)

        Returns:
            List of results in same order as tool_calls
        """
        from ray_agents.utils import execute_tools

        return execute_tools(tool_calls, parallel=parallel)

    @abstractmethod
    def run(self, data: dict[str, Any]) -> dict[str, Any]:
        """Main entry point for agent execution.

        This method MUST be implemented by all agents.

        Args:
            data: Input data from the client request

        Returns:
            Dict containing the agent's response

        Raises:
            NotImplementedError: If not implemented by subclass
        """
        raise NotImplementedError("Agents must implement the run() method")
