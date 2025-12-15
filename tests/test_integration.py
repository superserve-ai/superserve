"""Integration tests for RayToolWrapper with agent frameworks."""

from unittest.mock import patch

import pytest
import ray

from rayai.adapters import AgentFramework, RayToolWrapper


class TestLangChainIntegration:
    """Integration tests for LangChain agents with Ray tools."""

    @pytest.fixture
    def ray_calculator_tool(self, ray_start):
        """Create a Ray tool that performs calculations."""

        @ray.remote
        def calculate(operation: str, a: int, b: int) -> dict:
            """Perform a calculation."""
            if operation == "add":
                result = a + b
            elif operation == "multiply":
                result = a * b
            else:
                return {"status": "error", "error": f"Unknown operation: {operation}"}
            return {"status": "success", "result": result}

        calculate.__name__ = "calculate"
        calculate.__doc__ = "Perform a calculation (add or multiply)"
        return calculate

    def test_langchain_agent_with_ray_tools(self, ray_start, ray_calculator_tool):
        """Test full flow: LangChain agent calls Ray tool and returns response."""
        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)
        wrapped_tools = wrapper.wrap_tools([ray_calculator_tool])

        assert len(wrapped_tools) == 1

        # Verify the tool works when invoked (simulating agent tool call)
        tool = wrapped_tools[0]
        result = tool.invoke({"operation": "add", "a": 5, "b": 3})

        assert result == 8

    def test_langchain_tool_is_basetool(self, ray_start, ray_calculator_tool):
        """Test that wrapped tools are LangChain BaseTool instances."""
        pytest.importorskip("langchain_core")
        from langchain_core.tools import BaseTool

        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)
        wrapped_tools = wrapper.wrap_tools([ray_calculator_tool])

        # Wrapped tools should be BaseTool instances
        tool = wrapped_tools[0]
        assert isinstance(tool, BaseTool)
        assert tool.name is not None

        # Invoke through the tool
        result = tool.invoke({"operation": "multiply", "a": 4, "b": 5})
        assert result == 20


class TestPydanticIntegration:
    """Integration tests for Pydantic AI agents with Ray tools."""

    @pytest.fixture
    def ray_search_tool(self, ray_start):
        """Create a Ray tool that simulates search."""

        @ray.remote
        def search(query: str) -> dict:
            """Search for information."""
            # Simulate search results
            return {
                "status": "success",
                "result": f"Found results for: {query}",
            }

        search.__name__ = "search"
        search.__doc__ = "Search for information"
        return search

    def test_pydantic_agent_with_ray_tools(self, ray_start, ray_search_tool):
        """Test full flow: Pydantic AI agent calls Ray tool and returns response."""
        wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)
        wrapped_tools = wrapper.wrap_tools([ray_search_tool])

        assert len(wrapped_tools) == 1

        # Verify the tool works when called directly
        tool = wrapped_tools[0]
        result = tool(query="python ray")

        assert result == "Found results for: python ray"

    def test_pydantic_function_toolset_creation(self, ray_start, ray_search_tool):
        """Test that wrapped tools can be added to Pydantic FunctionToolset."""
        pytest.importorskip("pydantic_ai")
        from pydantic_ai import FunctionToolset

        wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)
        wrapped_tools = wrapper.wrap_tools([ray_search_tool])

        # This is what users would do to use with Pydantic AI
        toolset = FunctionToolset()
        for tool_func in wrapped_tools:
            toolset.add_function(tool_func)

        # Verify toolset was created without errors - the tool is registered
        # We can't easily check internals, but add_function would raise if invalid
        assert toolset is not None


class TestFromLangChainTool:
    """Test from_langchain_tool returns a usable LangChain tool."""

    def test_from_langchain_tool_returns_langchain_tool(self, ray_start):
        """Test that from_langchain_tool returns a LangChain BaseTool."""
        pytest.importorskip("langchain_core")
        from langchain_core.tools import BaseTool
        from langchain_core.tools import tool as langchain_tool

        from rayai.adapters.langchain import from_langchain_tool

        @langchain_tool
        def greet(name: str) -> str:
            """Greet someone by name."""
            return f"Hello, {name}!"

        # Convert to Ray-executed LangChain tool
        ray_greet = from_langchain_tool(greet)

        # Should be a LangChain BaseTool
        assert isinstance(ray_greet, BaseTool)
        assert ray_greet.name == "greet"
        assert "Greet someone" in ray_greet.description

        # Should work when invoked
        result = ray_greet.invoke("World")
        assert result == "Hello, World!"

    def test_from_langchain_tool_async(self, ray_start):
        """Test that from_langchain_tool works with async invocation."""
        pytest.importorskip("langchain_core")
        import asyncio

        from langchain_core.tools import tool as langchain_tool

        from rayai.adapters.langchain import from_langchain_tool

        @langchain_tool
        def add(a: int, b: int) -> int:
            """Add two numbers."""
            return a + b

        ray_add = from_langchain_tool(add)

        # Should work with async invocation
        result = asyncio.get_event_loop().run_until_complete(
            ray_add.ainvoke({"a": 2, "b": 3})
        )
        assert result == 5


class TestToolExecutionDistributed:
    """Test that tools actually execute on Ray workers."""

    def test_tool_executes_via_ray_get(self, ray_start):
        """Verify tool execution goes through ray.get."""
        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def tracked_tool(x: int) -> int:
            return x * 2

        wrapped = wrapper.wrap_tools([tracked_tool])

        # Patch ray.get in core module to verify it's called
        with patch("rayai.adapters.core.ray.get") as mock_get:
            # Set up mock to return actual result
            mock_get.return_value = 10

            result = wrapped[0].invoke({"x": 5})

            # Verify ray.get was called
            mock_get.assert_called_once()
            assert result == 10

    def test_multiple_tools_execute_independently(self, ray_start):
        """Test that multiple tools can be wrapped and called independently."""
        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def tool_a(x: int) -> dict:
            return {"status": "success", "result": x + 1}

        @ray.remote
        def tool_b(x: int) -> dict:
            return {"status": "success", "result": x * 2}

        wrapped = wrapper.wrap_tools([tool_a, tool_b])

        assert len(wrapped) == 2

        # Use .invoke() for LangChain tools
        result_a = wrapped[0].invoke({"x": 5})
        result_b = wrapped[1].invoke({"x": 5})

        assert result_a == 6  # 5 + 1
        assert result_b == 10  # 5 * 2
