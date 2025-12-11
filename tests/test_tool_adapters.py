"""Unit tests for ToolAdapter."""

import pytest
import ray

from ray_agents.adapters import AgentFramework, ToolAdapter


class TestToolAdapter:
    """Tests for ToolAdapter class."""

    def test_adapter_accepts_framework_param(self):
        """Test that adapter accepts framework parameter."""
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)
        assert adapter.framework == AgentFramework.LANGCHAIN

        adapter = ToolAdapter(framework=AgentFramework.PYDANTIC)
        assert adapter.framework == AgentFramework.PYDANTIC

    def test_wrap_tools_returns_list(self, ray_start):
        """Test that wrap_tools returns a list of callables."""
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def dummy_tool(x: str) -> str:
            return f"result: {x}"

        wrapped = adapter.wrap_tools([dummy_tool])

        assert isinstance(wrapped, list)
        assert len(wrapped) == 1
        assert callable(wrapped[0])

    def test_wrapped_tool_executes_on_ray(self, ray_start):
        """Test that wrapped tool dispatches to Ray cluster."""
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def add_numbers(a: int, b: int) -> int:
            return a + b

        wrapped = adapter.wrap_tools([add_numbers])
        result = wrapped[0](a=2, b=3)

        assert result == 5

    def test_wrapped_tool_handles_error_status(self, ray_start):
        """Test that wrapped tool raises RuntimeError on error status."""
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def failing_tool() -> dict:
            return {"status": "error", "error": "Something went wrong"}

        wrapped = adapter.wrap_tools([failing_tool])

        with pytest.raises(RuntimeError, match="Tool error: Something went wrong"):
            wrapped[0]()

    def test_wrapped_tool_extracts_result(self, ray_start):
        """Test that wrapped tool extracts result from status dict."""
        adapter = ToolAdapter(framework=AgentFramework.PYDANTIC)

        @ray.remote
        def tool_with_status() -> dict:
            return {"status": "success", "result": "extracted value"}

        wrapped = adapter.wrap_tools([tool_with_status])
        result = wrapped[0]()

        assert result == "extracted value"

    def test_wrapped_tool_preserves_plain_result(self, ray_start):
        """Test that wrapped tool returns plain results as-is."""
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def plain_tool() -> str:
            return "plain result"

        wrapped = adapter.wrap_tools([plain_tool])
        result = wrapped[0]()

        assert result == "plain result"

    def test_wrap_tools_skips_non_ray_functions(self, ray_start):
        """Test that wrap_tools skips non-Ray functions with warning."""
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)

        def not_a_ray_tool(x: str) -> str:
            return x

        wrapped = adapter.wrap_tools([not_a_ray_tool])
        assert wrapped == []

    def test_wrapped_tool_preserves_args_schema(self, ray_start):
        """Test that wrapped tool preserves args_schema attribute."""
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def tool_func(query: str) -> str:
            return query

        # Simulate a tool with args_schema (like from from_langchain_tool)
        tool_func.args_schema = {
            "type": "object",
            "properties": {"query": {"type": "string"}},
        }

        wrapped = adapter.wrap_tools([tool_func])

        assert hasattr(wrapped[0], "args_schema")
        assert wrapped[0].args_schema == {
            "type": "object",
            "properties": {"query": {"type": "string"}},
        }

    def test_wrap_tools_handles_remote_func_attribute(self, ray_start):
        """Test that wrap_tools handles tools with _remote_func attribute."""
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)

        @ray.remote
        def actual_remote(x: int) -> int:
            return x * 2

        # Create a wrapper that has _remote_func (like from @tool decorator)
        def wrapper(x: int) -> int:
            return ray.get(actual_remote.remote(x))

        wrapper._remote_func = actual_remote

        wrapped = adapter.wrap_tools([wrapper])

        assert len(wrapped) == 1
        result = wrapped[0](x=5)
        assert result == 10

    def test_both_frameworks_produce_working_wrappers(self, ray_start):
        """Test that both LangChain and Pydantic frameworks produce working wrappers."""

        @ray.remote
        def shared_tool(message: str) -> dict:
            return {"status": "success", "result": f"processed: {message}"}

        langchain_adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)
        pydantic_adapter = ToolAdapter(framework=AgentFramework.PYDANTIC)

        lc_wrapped = langchain_adapter.wrap_tools([shared_tool])
        pd_wrapped = pydantic_adapter.wrap_tools([shared_tool])

        # Both should work identically
        lc_result = lc_wrapped[0](message="hello")
        pd_result = pd_wrapped[0](message="hello")

        assert lc_result == "processed: hello"
        assert pd_result == "processed: hello"
