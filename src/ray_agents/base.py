"""Base protocols for Agentic-Ray framework."""

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class AgentProtocol(Protocol):
    """Protocol defining the interface for servable agents.

    Any class with a run(data: dict) -> dict method can be served.
    No inheritance required - just implement the method.

    Example:
        class MyAgent:
            def run(self, data: dict) -> dict:
                return {"response": "Hello!"}
    """

    def run(self, data: dict[str, Any]) -> dict[str, Any]:
        """Execute the agent with input data.

        Args:
            data: Input data from the client request

        Returns:
            Dict containing the agent's response
        """
        ...
