"""Integration tests for ToolAdapter with agent frameworks."""

from unittest.mock import patch

import pytest
import ray

from ray_agents.adapters import AgentFramework, ToolAdapter


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
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)
        wrapped_tools = adapter.wrap_tools([ray_calculator_tool])

        assert len(wrapped_tools) == 1

        # Verify the tool works when called directly (simulating agent tool call)
        tool = wrapped_tools[0]
        result = tool(operation="add", a=5, b=3)

        assert result == 8

    def test_langchain_structured_tool_creation(self, ray_start, ray_calculator_tool):
        """Test that wrapped tools can be converted to LangChain StructuredTool."""
        pytest.importorskip("langchain_core")
        from langchain_core.tools import StructuredTool

        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)
        wrapped_tools = adapter.wrap_tools([ray_calculator_tool])

        # This is what users would do to use with LangChain
        tool_func = wrapped_tools[0]
        structured_tool = StructuredTool.from_function(
            func=tool_func,
            name="calculate",
            description="Perform a calculation",
        )

        assert structured_tool.name == "calculate"

        # Invoke through StructuredTool
        result = structured_tool.invoke({"operation": "multiply", "a": 4, "b": 5})
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
        adapter = ToolAdapter(framework=AgentFramework.PYDANTIC)
        wrapped_tools = adapter.wrap_tools([ray_search_tool])

        assert len(wrapped_tools) == 1

        # Verify the tool works when called directly
        tool = wrapped_tools[0]
        result = tool(query="python ray")

        assert result == "Found results for: python ray"

    def test_pydantic_function_toolset_creation(self, ray_start, ray_search_tool):
        """Test that wrapped tools can be added to Pydantic FunctionToolset."""
        pytest.importorskip("pydantic_ai")
        from pydantic_ai import FunctionToolset

        adapter = ToolAdapter(framework=AgentFramework.PYDANTIC)
        wrapped_tools = adapter.wrap_tools([ray_search_tool])

        # This is what users would do to use with Pydantic AI
        toolset = FunctionToolset()
        for tool_func in wrapped_tools:
            toolset.add_function(tool_func)

        # Verify toolset was created without errors - the tool is registered
        # We can't easily check internals, but add_function would raise if invalid
        assert toolset is not None


class TestCrossFrameworkTools:
    """Test using tools from one framework with another."""

    def test_langchain_tool_with_pydantic_adapter(self, ray_start):
        """Test converting LangChain tool to Ray, then wrapping for Pydantic."""
        pytest.importorskip("langchain_core")
        from langchain_core.tools import tool as langchain_tool

        from ray_agents.adapters.langchain import from_langchain_tool

        # Create a LangChain tool
        @langchain_tool
        def greet(name: str) -> str:
            """Greet someone by name."""
            return f"Hello, {name}!"

        # Convert to Ray tool
        ray_greet = from_langchain_tool(greet)

        # Wrap for Pydantic
        adapter = ToolAdapter(framework=AgentFramework.PYDANTIC)
        wrapped = adapter.wrap_tools([ray_greet])

        assert len(wrapped) == 1

        # Should work with Pydantic agent
        result = wrapped[0](name="World")
        assert result == "Hello, World!"


class TestToolExecutionDistributed:
    """Test that tools actually execute on Ray workers."""

    def test_tool_executes_via_ray_get(self, ray_start):
        """Verify tool execution goes through ray.get."""
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def tracked_tool(x: int) -> int:
            return x * 2

        wrapped = adapter.wrap_tools([tracked_tool])

        # Patch ray.get to verify it's called
        with patch("ray_agents.adapters.abc.ray.get") as mock_get:
            # Set up mock to return actual result
            mock_get.return_value = 10

            result = wrapped[0](x=5)

            # Verify ray.get was called
            mock_get.assert_called_once()
            assert result == 10

    def test_multiple_tools_execute_independently(self, ray_start):
        """Test that multiple tools can be wrapped and called independently."""
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def tool_a(x: int) -> dict:
            return {"status": "success", "result": x + 1}

        @ray.remote
        def tool_b(x: int) -> dict:
            return {"status": "success", "result": x * 2}

        wrapped = adapter.wrap_tools([tool_a, tool_b])

        assert len(wrapped) == 2

        result_a = wrapped[0](x=5)
        result_b = wrapped[1](x=5)

        assert result_a == 6  # 5 + 1
        assert result_b == 10  # 5 * 2
