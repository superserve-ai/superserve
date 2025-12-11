"""Tests for parallel tool execution."""

import time

import pytest
import ray

from ray_agents import execute_tools, tool
from ray_agents.adapters import AgentFramework, ToolAdapter


class TestParallelToolCalls:
    """Test parallel execution of tools using Ray."""

    def test_parallel_execution_starts_simultaneously(self, ray_start):
        """Test that parallel tools start at the same time."""

        @tool(desc="Slow tool 1")
        def slow_tool_1(x: int) -> dict:
            """A slow tool that returns its start time."""
            start_time = time.time()
            time.sleep(0.3)
            return {"result": x * 2, "start_time": start_time}

        @tool(desc="Slow tool 2")
        def slow_tool_2(x: int) -> dict:
            """A slow tool that returns its start time."""
            start_time = time.time()
            time.sleep(0.3)
            return {"result": x * 3, "start_time": start_time}

        # Parallel execution using Ray directly
        remote_1 = slow_tool_1._remote_func
        remote_2 = slow_tool_2._remote_func

        results = ray.get([remote_1.remote(5), remote_2.remote(5)])

        assert results[0]["result"] == 10  # 5 * 2
        assert results[1]["result"] == 15  # 5 * 3

        # Both tools should start within 0.15s of each other (parallel)
        # If sequential, second would start ~0.3s after first
        time_diff = abs(results[0]["start_time"] - results[1]["start_time"])
        assert (
            time_diff < 0.15
        ), f"Tools started {time_diff}s apart, expected < 0.15s (parallel)"

    def test_sequential_execution_takes_longer(self, ray_start):
        """Test that sequential execution takes sum of all tool times."""

        @tool(desc="Slow tool")
        def slow_tool(x: int) -> int:
            """A slow tool."""
            time.sleep(0.2)
            return x * 2

        # Sequential execution (normal calls)
        start = time.time()
        result1 = slow_tool(x=5)
        result2 = slow_tool(x=10)
        sequential_time = time.time() - start

        assert result1 == 10
        assert result2 == 20

        # Sequential should take ~0.4s (0.2 + 0.2)
        assert (
            sequential_time >= 0.35
        ), f"Sequential took {sequential_time}s, expected >= 0.35s"

    def test_execute_tools_helper_sequential(self, ray_start):
        """Test execute_tools helper with parallel=False."""

        @tool(desc="Add one")
        def add_one(x: int) -> int:
            """Add one."""
            return x + 1

        @tool(desc="Square")
        def square(x: int) -> int:
            """Square the input."""
            return x * x

        tool_calls = [
            (add_one, {"x": 5}),
            (square, {"x": 3}),
        ]

        results = execute_tools(tool_calls, parallel=False)

        assert len(results) == 2
        assert results[0] == 6  # 5 + 1
        assert results[1] == 9  # 3 * 3

    def test_execute_tools_parallel_starts_simultaneously(self, ray_start):
        """Test that execute_tools with parallel=True starts tools simultaneously."""

        @tool(desc="Slow tool")
        def slow_tool(x: int) -> dict:
            """A slow tool that returns its start time."""
            start_time = time.time()
            time.sleep(0.2)
            return {"result": x * 2, "start_time": start_time}

        tool_calls = [
            (slow_tool, {"x": 1}),
            (slow_tool, {"x": 2}),
            (slow_tool, {"x": 3}),
        ]

        # Parallel execution
        parallel_results = execute_tools(tool_calls, parallel=True)

        assert parallel_results[0]["result"] == 2
        assert parallel_results[1]["result"] == 4
        assert parallel_results[2]["result"] == 6

        # All 3 tools should start within 0.15s of each other (parallel)
        start_times = [r["start_time"] for r in parallel_results]
        max_diff = max(start_times) - min(start_times)
        assert max_diff < 0.15, f"Tools started {max_diff}s apart, expected < 0.15s"

    def test_execute_tools_preserves_order(self, ray_start):
        """Test that execute_tools returns results in same order as input."""

        @tool(desc="Identity")
        def identity(x: int) -> int:
            """Return input."""
            return x

        tool_calls = [
            (identity, {"x": 10}),
            (identity, {"x": 20}),
            (identity, {"x": 30}),
        ]

        results = execute_tools(tool_calls, parallel=True)

        assert results == [10, 20, 30]

    def test_execute_tools_empty_list(self, ray_start):
        """Test execute_tools with empty list."""
        results = execute_tools([], parallel=True)
        assert results == []

        results = execute_tools([], parallel=False)
        assert results == []


class TestLangChainAgentParallelToolCalls:
    """Test LangChain agent executes parallel tool calls via Ray."""

    @pytest.mark.asyncio
    async def test_langchain_agent_parallel_tool_execution(self, ray_start):
        """Test that LangChain agent with mocked LLM executes tools in parallel."""
        pytest.importorskip("langchain_core")
        pytest.importorskip("langgraph")

        from langchain_core.messages import AIMessage, HumanMessage
        from langgraph.prebuilt import create_react_agent

        from ray_agents import tool

        # Track start times via Ray actor for cross-process coordination
        @ray.remote
        class TimeTracker:
            def __init__(self):
                self.start_times = {}

            def record(self, name: str, t: float):
                self.start_times[name] = t

            def get_times(self):
                return self.start_times

        tracker = TimeTracker.remote()

        # Create slow tools that record their start times
        @tool(desc="Slow tool A")
        def slow_tool_a(x: int) -> int:
            """Slow tool A that takes 0.3s."""
            ray.get(tracker.record.remote("slow_tool_a", time.time()))
            time.sleep(0.3)
            return x * 2

        @tool(desc="Slow tool B")
        def slow_tool_b(x: int) -> int:
            """Slow tool B that takes 0.3s."""
            ray.get(tracker.record.remote("slow_tool_b", time.time()))
            time.sleep(0.3)
            return x * 3

        # Wrap tools for LangChain
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)
        lc_tools = adapter.wrap_tools([slow_tool_a, slow_tool_b])

        # Create a mock LLM that returns parallel tool calls
        from langchain_core.language_models.chat_models import BaseChatModel
        from langchain_core.outputs import ChatGeneration, ChatResult

        call_count = 0

        class MockChatModel(BaseChatModel):
            @property
            def _llm_type(self) -> str:
                return "mock"

            def bind_tools(self, tools, **kwargs):
                return self

            def _generate(self, messages, stop=None, run_manager=None, **kwargs):
                nonlocal call_count
                call_count += 1

                if call_count == 1:
                    msg = AIMessage(
                        content="",
                        tool_calls=[
                            {"id": "1", "name": "slow_tool_a", "args": {"x": 5}},
                            {"id": "2", "name": "slow_tool_b", "args": {"x": 5}},
                        ],
                    )
                else:
                    msg = AIMessage(content="Done! Results: 10 and 15")
                return ChatResult(generations=[ChatGeneration(message=msg)])

        mock_llm = MockChatModel()
        agent = create_react_agent(mock_llm, lc_tools)

        # Run the agent
        await agent.ainvoke(
            {"messages": [HumanMessage(content="Run both tools with x=5")]}
        )

        # Verify tools were called
        assert call_count == 2  # LLM called twice (tool calls + final response)

        # Verify tools started at approximately the same time (parallel execution)
        start_times = ray.get(tracker.get_times.remote())
        assert len(start_times) == 2, f"Expected 2 tools, got {len(start_times)}"
        time_diff = abs(start_times["slow_tool_a"] - start_times["slow_tool_b"])
        assert time_diff < 0.15, f"Tools started {time_diff}s apart, expected < 0.15s"
