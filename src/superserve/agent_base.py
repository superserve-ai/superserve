"""Base class for custom agents without a framework.

For users who want to build agents without using Pydantic AI, LangChain,
or other frameworks, this provides a simple base class with tool execution.

Example:
    import superserve

    @superserve.tool
    def search(query: str) -> str:
        '''Search the web.'''
        return f"Results for {query}"

    class MyAgent(superserve.Agent):
        tools = [search]

        async def run(self, query: str) -> str:
            # Your custom agent logic
            result = await self.call_tool("search", query=query)
            return f"Found: {result}"

    # Serve the agent
    superserve.serve(MyAgent(), name="my-agent")
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import Any


class Agent(ABC):
    """Base class for custom agents.

    Provides a simple interface for building agents with tool execution.
    Subclass this and implement the `run` method with your agent logic.

    Attributes:
        tools: List of @superserve.tool decorated functions available to the agent.
    """

    tools: list[Any] = []

    @abstractmethod
    async def run(self, query: str) -> str:
        """Process a query and return a response.

        Override this method with your agent's logic.

        Args:
            query: The user's input query.

        Returns:
            The agent's response.
        """
        raise NotImplementedError

    async def call_tool(self, tool_name: str, **kwargs: Any) -> Any:
        """Call a registered tool by name.

        Args:
            tool_name: Name of the tool to call.
            **kwargs: Arguments to pass to the tool.

        Returns:
            The tool's result.

        Raises:
            ValueError: If tool is not found.
        """
        tool = self._find_tool(tool_name)
        return await self._execute_tool(tool, **kwargs)

    async def call_tools_parallel(
        self,
        calls: list[tuple[str, dict[str, Any]]],
    ) -> list[Any]:
        """Call multiple tools in parallel.

        Args:
            calls: List of (tool_name, kwargs) tuples.

        Returns:
            List of results in the same order as calls.

        Example:
            results = await self.call_tools_parallel([
                ("search", {"query": "python"}),
                ("analyze", {"data": "some data"}),
            ])
        """
        tasks = [
            self._execute_tool(self._find_tool(name), **kwargs)
            for name, kwargs in calls
        ]
        return await asyncio.gather(*tasks)

    def _find_tool(self, name: str) -> Any:
        """Find a tool by name.

        Args:
            name: Name of the tool.

        Returns:
            The tool function.

        Raises:
            ValueError: If tool not found.
        """
        for tool in self.tools:
            tool_name = getattr(tool, "__name__", None) or getattr(tool, "name", None)
            if tool_name == name:
                return tool

        available = [
            getattr(t, "__name__", None) or getattr(t, "name", "unknown")
            for t in self.tools
        ]
        raise ValueError(f"Tool '{name}' not found. Available tools: {available}")

    async def _execute_tool(self, tool: Any, **kwargs: Any) -> Any:
        """Execute a tool with the given arguments.

        Args:
            tool: The tool function to execute.
            **kwargs: Arguments to pass to the tool.

        Returns:
            The tool's result.
        """
        # Check if it's a superserve tool (async)
        if getattr(tool, "_superserve_tool", False):
            return await tool(**kwargs)

        # Check if it's a regular async function
        if asyncio.iscoroutinefunction(tool):
            return await tool(**kwargs)

        # Sync function - run in executor
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: tool(**kwargs))

    def get_tool_names(self) -> list[str]:
        """Get names of all registered tools.

        Returns:
            List of tool names.
        """
        names: list[str] = []
        for t in self.tools:
            name = getattr(t, "__name__", None) or getattr(t, "name", None)
            names.append(str(name) if name else "unknown")
        return names

    def get_tool_descriptions(self) -> dict[str, str]:
        """Get descriptions of all registered tools.

        Returns:
            Dictionary mapping tool names to descriptions.
        """
        descriptions: dict[str, str] = {}
        for tool in self.tools:
            name_attr = getattr(tool, "__name__", None) or getattr(tool, "name", None)
            name = str(name_attr) if name_attr else "unknown"
            # Try to get description from metadata or docstring
            metadata = getattr(tool, "_tool_metadata", {})
            desc = metadata.get("description") or tool.__doc__ or "No description"
            descriptions[name] = str(desc)
        return descriptions
