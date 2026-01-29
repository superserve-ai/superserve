"""Tests for the unified @superserve.tool decorator."""

import asyncio

import pytest
import ray


@pytest.fixture(scope="module", autouse=True)
def init_ray():
    """Initialize Ray for tests."""
    if not ray.is_initialized():
        ray.init(ignore_reinit_error=True)
    yield
    # Don't shut down Ray to avoid issues with other tests


class TestToolDecorator:
    """Tests for @superserve.tool decorator."""

    def test_decorator_without_args(self):
        """@superserve.tool without arguments."""
        from superserve import tool

        @tool
        def simple_func(x: int) -> int:
            return x * 2

        assert asyncio.iscoroutinefunction(simple_func)
        assert hasattr(simple_func, "_superserve_tool")
        assert simple_func._superserve_tool is True

    def test_decorator_with_args(self):
        """@superserve.tool with explicit resources."""
        from superserve import tool

        @tool(num_cpus=2, memory="1GB")
        def resource_func(x: int) -> int:
            return x * 2

        assert asyncio.iscoroutinefunction(resource_func)
        assert resource_func._tool_metadata["num_cpus"] == 2
        assert resource_func._tool_metadata["memory"] == "1GB"

    def test_preserves_function_metadata(self):
        """Preserves __name__ and __doc__."""
        from superserve import tool

        @tool
        def my_named_func(x: int) -> int:
            """My docstring."""
            return x

        assert my_named_func.__name__ == "my_named_func"
        assert "My docstring" in my_named_func.__doc__

    def test_async_execution(self):
        """Tool executes asynchronously."""
        from superserve import tool

        @tool
        def add(a: int, b: int) -> int:
            return a + b

        async def run_test():
            return await add(2, 3)

        result = asyncio.get_event_loop().run_until_complete(run_test())
        assert result == 5

    def test_parallel_execution(self):
        """Multiple tools can run in parallel."""
        import time

        from superserve import tool

        @tool
        def slow_op(x: int) -> int:
            time.sleep(0.1)
            return x * 2

        async def run_parallel():
            start = time.time()
            results = await asyncio.gather(
                slow_op(1),
                slow_op(2),
                slow_op(3),
            )
            elapsed = time.time() - start
            return results, elapsed

        results, elapsed = asyncio.get_event_loop().run_until_complete(run_parallel())

        assert results == [2, 4, 6]
        # Should complete in ~0.1s, not 0.3s (allow extra time for Ray overhead)
        assert elapsed < 0.5

    def test_has_remote_func(self):
        """Decorated function has _remote_func attribute."""
        from superserve import tool

        @tool
        def remote_test(x: int) -> int:
            return x

        assert hasattr(remote_test, "_get_remote_func")
        assert callable(remote_test._get_remote_func)

    def test_has_original_func(self):
        """Decorated function has _original_func attribute."""
        from superserve import tool

        @tool
        def original_test(x: int) -> int:
            return x

        assert hasattr(original_test, "_original_func")
        assert callable(original_test._original_func)


class TestToolAsWrapper:
    """Tests for superserve.tool() as a wrapper for framework tools."""

    def test_wrap_callable(self):
        """Wrap a plain callable."""
        from superserve import tool

        def my_callable(x: int) -> int:
            return x * 3

        wrapped = tool(my_callable)
        assert asyncio.iscoroutinefunction(wrapped)
        assert wrapped._superserve_tool is True

    def test_wrapped_callable_execution(self):
        """Wrapped callable executes correctly."""
        from superserve import tool

        def multiply(x: int, y: int) -> int:
            return x * y

        wrapped = tool(multiply)

        async def run_test():
            return await wrapped(4, 5)

        result = asyncio.get_event_loop().run_until_complete(run_test())
        assert result == 20


class TestToolMetadata:
    """Tests for tool metadata."""

    def test_default_resources(self):
        """Default resources when not specified."""
        from superserve import tool

        @tool
        def default_func(x: int) -> int:
            return x

        metadata = default_func._tool_metadata
        assert metadata["num_cpus"] == 1
        assert metadata["num_gpus"] == 0
        assert metadata["memory"] is None

    def test_description_from_docstring(self):
        """Description comes from docstring."""
        from superserve import tool

        @tool
        def described_func(x: int) -> int:
            """This is my description."""
            return x

        assert "This is my description" in described_func._tool_metadata["description"]

    def test_description_fallback(self):
        """Fallback description when no docstring."""
        from superserve import tool

        @tool
        def no_doc_func(x: int) -> int:
            return x

        assert "no_doc_func" in no_doc_func._tool_metadata["description"]
