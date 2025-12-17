"""Unit tests for RayToolWrapper and cross-framework conversion."""

import pytest
import ray

from rayai.adapters import AgentFramework, RayToolWrapper
from rayai.adapters.core import (
    RayTool,
    SourceFramework,
    detect_framework,
)


class TestFrameworkDetection:
    """Tests for auto-detecting source framework."""

    def test_detect_ray_remote_function(self, ray_start):
        """Test detection of Ray remote functions."""

        @ray.remote
        def my_tool(x: str) -> str:
            return x

        assert detect_framework(my_tool) == SourceFramework.RAY_TOOL

    def test_detect_tool_with_remote_func_attribute(self, ray_start):
        """Test detection of tools with _remote_func attribute."""

        @ray.remote
        def actual_remote(x: int) -> int:
            return x

        def tool_wrapper(x: int) -> int:
            return ray.get(actual_remote.remote(x))

        tool_wrapper._remote_func = actual_remote

        assert detect_framework(tool_wrapper) == SourceFramework.RAY_TOOL

    def test_detect_langchain_tool(self, ray_start):
        """Test detection of LangChain BaseTool."""
        pytest.importorskip("langchain_core")
        from langchain_core.tools import tool as langchain_tool

        @langchain_tool
        def greet(name: str) -> str:
            """Greet someone."""
            return f"Hello, {name}!"

        assert detect_framework(greet) == SourceFramework.LANGCHAIN

    def test_detect_pydantic_tool(self, ray_start):
        """Test detection of Pydantic AI Tool."""
        pytest.importorskip("pydantic_ai")
        from pydantic_ai import Tool

        def my_func(x: int) -> int:
            return x * 2

        tool = Tool(my_func, name="double")
        assert detect_framework(tool) == SourceFramework.PYDANTIC

    def test_detect_plain_callable(self, ray_start):
        """Test detection of plain callable."""

        def my_func(x: int) -> int:
            """Double a number."""
            return x * 2

        assert detect_framework(my_func) == SourceFramework.CALLABLE

    def test_detect_raises_for_unknown(self, ray_start):
        """Test that detection raises ValueError for unknown types."""
        with pytest.raises(ValueError, match="Cannot detect framework"):
            detect_framework("not a tool")


class TestRayToolDataclass:
    """Tests for the RayTool canonical representation."""

    def test_raytool_has_expected_fields(self):
        """Test RayTool dataclass has expected fields."""
        # Should be importable and have expected attributes
        assert hasattr(RayTool, "__dataclass_fields__")
        fields = RayTool.__dataclass_fields__
        assert "name" in fields
        assert "description" in fields
        assert "ray_remote" in fields
        assert "func" in fields
        assert "args_schema" in fields
        assert "signature" in fields
        assert "annotations" in fields


class TestCrossFrameworkConversion:
    """Tests for cross-framework tool conversion."""

    def test_langchain_to_pydantic(self, ray_start):
        """Test LangChain tool to Pydantic conversion."""
        pytest.importorskip("langchain_core")
        from langchain_core.tools import tool as langchain_tool

        @langchain_tool
        def search(query: str) -> str:
            """Search the web for information."""
            return f"Results for: {query}"

        wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)
        pydantic_tools = wrapper.wrap_tools([search])

        assert len(pydantic_tools) == 1
        pydantic_tool = pydantic_tools[0]

        # Should be a callable with metadata
        assert callable(pydantic_tool)
        assert pydantic_tool.__name__ == "search"
        assert pydantic_tool.__doc__ and "Search" in pydantic_tool.__doc__

        # Should execute correctly
        result = pydantic_tool(query="python")
        assert "python" in result

    def test_pydantic_to_langchain(self, ray_start):
        """Test Pydantic tool to LangChain conversion."""
        pytest.importorskip("pydantic_ai")
        pytest.importorskip("langchain_core")
        from langchain_core.tools import BaseTool
        from pydantic_ai import Tool

        def multiply(x: int, y: int) -> int:
            """Multiply two numbers together."""
            return x * y

        pydantic_tool = Tool(multiply, name="multiply", description="Multiply numbers")

        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)
        lc_tools = wrapper.wrap_tools([pydantic_tool])

        assert len(lc_tools) == 1
        lc_tool = lc_tools[0]

        # Should be a LangChain BaseTool
        assert isinstance(lc_tool, BaseTool)
        assert lc_tool.name == "multiply"
        assert "Multiply" in lc_tool.description

        # Should execute correctly
        result = lc_tool.invoke({"x": 3, "y": 4})
        assert result == 12

    def test_callable_to_pydantic(self, ray_start):
        """Test plain callable to Pydantic conversion."""

        def calculate(a: int, b: int) -> int:
            """Add two numbers."""
            return a + b

        wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)
        pydantic_tools = wrapper.wrap_tools([calculate])

        assert len(pydantic_tools) == 1
        pydantic_tool = pydantic_tools[0]

        assert callable(pydantic_tool)
        assert pydantic_tool.__name__ == "calculate"
        assert pydantic_tool.__doc__ and "Add two numbers" in pydantic_tool.__doc__

        # Check annotations are preserved
        assert "a" in pydantic_tool.__annotations__
        assert "b" in pydantic_tool.__annotations__

    def test_callable_to_langchain(self, ray_start):
        """Test plain callable to LangChain conversion."""
        pytest.importorskip("langchain_core")
        from langchain_core.tools import BaseTool

        def greet(name: str) -> str:
            """Greet a person by name."""
            return f"Hello, {name}!"

        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)
        lc_tools = wrapper.wrap_tools([greet])

        assert len(lc_tools) == 1
        lc_tool = lc_tools[0]

        assert isinstance(lc_tool, BaseTool)
        assert lc_tool.name == "greet"

    def test_mixed_tools_conversion(self, ray_start):
        """Test converting mixed tools from different frameworks."""
        pytest.importorskip("langchain_core")
        from langchain_core.tools import tool as langchain_tool

        @langchain_tool
        def lc_search(query: str) -> str:
            """LangChain search tool."""
            return f"LC: {query}"

        def plain_func(x: int) -> int:
            """Plain function."""
            return x * 2

        wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)
        pydantic_tools = wrapper.wrap_tools([lc_search, plain_func])

        assert len(pydantic_tools) == 2

        # Both should work
        assert "LC:" in pydantic_tools[0](query="test")
        assert pydantic_tools[1](x=5) == 10


class TestResourceConfiguration:
    """Tests for Ray resource configuration."""

    def test_custom_cpu_allocation(self, ray_start):
        """Test custom CPU allocation."""

        def my_func(x: int) -> int:
            return x

        wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)
        # Should not error with custom resources
        result = wrapper.wrap_tools([my_func], num_cpus=2)
        assert len(result) == 1

    def test_memory_in_gb(self, ray_start):
        """Test memory specification in GB."""

        def my_func(x: int) -> int:
            return x

        wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)
        # 1.0 should be interpreted as 1GB
        result = wrapper.wrap_tools([my_func], memory=1.0)
        assert len(result) == 1


class TestRayToolWrapper:
    """Tests for RayToolWrapper class."""

    def test_wrapper_accepts_framework_param(self):
        """Test that wrapper accepts framework parameter."""
        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)
        assert wrapper.framework == AgentFramework.LANGCHAIN

        wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)
        assert wrapper.framework == AgentFramework.PYDANTIC

    def test_wrap_tools_returns_list(self, ray_start):
        """Test that wrap_tools returns a list of callables."""
        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def dummy_tool(x: str) -> str:
            return f"result: {x}"

        wrapped = wrapper.wrap_tools([dummy_tool])

        assert isinstance(wrapped, list)
        assert len(wrapped) == 1
        assert hasattr(wrapped[0], "invoke")

    def test_wrapped_tool_executes_on_ray(self, ray_start):
        """Test that wrapped tool dispatches to Ray cluster."""
        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def add_numbers(a: int, b: int) -> int:
            return a + b

        wrapped = wrapper.wrap_tools([add_numbers])
        # LangChain tools should be invoked with .invoke()
        result = wrapped[0].invoke({"a": 2, "b": 3})

        assert result == 5

    def test_wrapped_tool_handles_error_status(self, ray_start):
        """Test that wrapped tool raises RuntimeError on error status."""
        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def failing_tool() -> dict:
            return {"status": "error", "error": "Something went wrong"}

        wrapped = wrapper.wrap_tools([failing_tool])

        with pytest.raises(RuntimeError, match="Tool error: Something went wrong"):
            wrapped[0].invoke({})

    def test_wrapped_tool_extracts_result(self, ray_start):
        """Test that wrapped tool extracts result from status dict."""
        wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)

        @ray.remote
        def tool_with_status() -> dict:
            return {"status": "success", "result": "extracted value"}

        wrapped = wrapper.wrap_tools([tool_with_status])
        result = wrapped[0]()

        assert result == "extracted value"

    def test_wrapped_tool_preserves_plain_result(self, ray_start):
        """Test that wrapped tool returns plain results as-is."""
        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def plain_tool() -> str:
            return "plain result"

        wrapped = wrapper.wrap_tools([plain_tool])
        result = wrapped[0].invoke({})

        assert result == "plain result"

    def test_wrap_tools_converts_plain_callables(self, ray_start):
        """Test that wrap_tools converts plain callables to Ray-executed tools."""
        wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)

        def plain_func(x: str) -> str:
            """A plain function."""
            return f"result: {x}"

        wrapped = wrapper.wrap_tools([plain_func])
        assert len(wrapped) == 1
        assert callable(wrapped[0])
        # Should execute on Ray
        result = wrapped[0](x="test")
        assert result == "result: test"

    def test_wrapped_tool_preserves_args_schema(self, ray_start):
        """Test that wrapped tool preserves args_schema attribute."""
        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def tool_func(query: str) -> str:
            return query

        # Simulate a tool with args_schema (like from from_langchain_tool)
        tool_func.args_schema = {
            "type": "object",
            "properties": {"query": {"type": "string"}},
        }

        wrapped = wrapper.wrap_tools([tool_func])

        assert hasattr(wrapped[0], "args_schema")
        assert wrapped[0].args_schema == {
            "type": "object",
            "properties": {"query": {"type": "string"}},
        }

    def test_wrap_tools_handles_remote_func_attribute(self, ray_start):
        """Test that wrap_tools handles tools with _remote_func attribute."""
        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def actual_remote(x: int) -> int:
            return x * 2

        # Create a tool_wrapper that has _remote_func (like from @tool decorator)
        def tool_wrapper(x: int) -> int:
            return ray.get(actual_remote.remote(x))

        tool_wrapper._remote_func = actual_remote

        wrapped = wrapper.wrap_tools([tool_wrapper])

        assert len(wrapped) == 1
        # LangChain tools should be invoked with .invoke()
        result = wrapped[0].invoke({"x": 5})
        assert result == 10

    def test_both_frameworks_produce_working_wrappers(self, ray_start):
        """Test that both LangChain and Pydantic frameworks produce working wrappers."""

        @ray.remote
        def shared_tool(message: str) -> dict:
            return {"status": "success", "result": f"processed: {message}"}

        langchain_wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)
        pydantic_wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)

        lc_wrapped = langchain_wrapper.wrap_tools([shared_tool])
        pd_wrapped = pydantic_wrapper.wrap_tools([shared_tool])

        # LangChain uses .invoke() with dict, Pydantic uses direct call with kwargs
        lc_result = lc_wrapped[0].invoke({"message": "hello"})
        pd_result = pd_wrapped[0](message="hello")

        assert lc_result == "processed: hello"
        assert pd_result == "processed: hello"
