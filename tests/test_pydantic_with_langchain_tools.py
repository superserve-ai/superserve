"""Tests for Pydantic AI agent with LangChain tools converted to Ray."""

import pytest

from ray_agents.adapters import AgentFramework, ToolAdapter
from ray_agents.adapters.langchain import from_langchain_tool


class TestPydanticWithLangChainTools:
    """Test LangChain tools converted to Ray work with Pydantic AI via ToolAdapter."""

    def test_single_langchain_tool_with_pydantic_adapter(self, ray_start):
        """Test single LangChain tool works with Pydantic ToolAdapter."""
        pytest.importorskip("langchain_core")
        pytest.importorskip("pydantic_ai")

        from langchain_core.tools import tool as langchain_tool

        @langchain_tool
        def get_weather(city: str) -> str:
            """Get weather for a city."""
            return f"Weather in {city}: Sunny, 72°F"

        # Convert to Ray tool
        ray_weather = from_langchain_tool(get_weather)

        # Wrap with ToolAdapter for Pydantic
        adapter = ToolAdapter(framework=AgentFramework.PYDANTIC)
        wrapped_tools = adapter.wrap_tools([ray_weather])

        assert len(wrapped_tools) == 1

        result = wrapped_tools[0](city="San Francisco")
        assert "San Francisco" in result
        assert "Sunny" in result

    def test_multiple_langchain_tools_with_pydantic_adapter(self, ray_start):
        """Test multiple LangChain tools with Pydantic ToolAdapter."""
        pytest.importorskip("langchain_core")
        pytest.importorskip("pydantic_ai")

        from langchain_core.tools import tool as langchain_tool

        @langchain_tool
        def add(a: int, b: int) -> int:
            """Add two numbers."""
            return a + b

        @langchain_tool
        def multiply(a: int, b: int) -> int:
            """Multiply two numbers."""
            return a * b

        # Convert to Ray tools
        ray_add = from_langchain_tool(add)
        ray_multiply = from_langchain_tool(multiply)

        # Wrap with ToolAdapter for Pydantic
        adapter = ToolAdapter(framework=AgentFramework.PYDANTIC)
        wrapped_tools = adapter.wrap_tools([ray_add, ray_multiply])

        assert len(wrapped_tools) == 2
        assert wrapped_tools[0](a=3, b=4) == 7
        assert wrapped_tools[1](a=3, b=4) == 12

    def test_wrapped_tool_preserves_args_schema(self, ray_start):
        """Test that ToolAdapter preserves args_schema for Pydantic."""
        pytest.importorskip("langchain_core")
        pytest.importorskip("pydantic_ai")

        from langchain_core.tools import tool as langchain_tool

        @langchain_tool
        def search(query: str) -> str:
            """Search for something."""
            return f"Results for: {query}"

        ray_search = from_langchain_tool(search)

        # Verify args_schema exists on converted tool
        assert hasattr(ray_search, "args_schema")

        adapter = ToolAdapter(framework=AgentFramework.PYDANTIC)
        wrapped_tools = adapter.wrap_tools([ray_search])

        # Wrapped tool should also have args_schema
        assert hasattr(wrapped_tools[0], "args_schema")

    def test_cross_framework_langchain_to_pydantic(self, ray_start):
        """Test LangChain tool -> Ray -> Pydantic full flow."""
        pytest.importorskip("langchain_core")
        pytest.importorskip("pydantic_ai")

        from langchain_core.tools import tool as langchain_tool

        @langchain_tool
        def greet(name: str) -> str:
            """Greet someone by name."""
            return f"Hello, {name}!"

        # Convert LangChain -> Ray
        ray_greet = from_langchain_tool(greet)

        # Wrap for Pydantic
        adapter = ToolAdapter(framework=AgentFramework.PYDANTIC)
        pydantic_tools = adapter.wrap_tools([ray_greet])

        # Should work end-to-end
        result = pydantic_tools[0](name="World")
        assert result == "Hello, World!"
