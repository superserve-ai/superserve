"""Tests for AgentSession tool execution."""

import ray

from ray_agents import AgentSession
from ray_agents.adapters import _MockAdapter as MockAdapter


def test_agent_session_run_with_tools(ray_start):
    """Test agent execution with Ray remote tools."""

    @ray.remote
    def test_tool_1():
        return "result_1"

    @ray.remote
    def test_tool_2():
        return "result_2"

    adapter = MockAdapter()
    session = AgentSession.remote(session_id="test", adapter=adapter)

    # Run agent with tools
    result = ray.get(
        session.run.remote("Test message", tools=[test_tool_1, test_tool_2])
    )

    # Verify response includes tool results
    assert "content" in result
    assert "tool_results" in result
    assert len(result["tool_results"]) == 2
    assert "result_1" in result["tool_results"]
    assert "result_2" in result["tool_results"]


def test_distributed_tool_execution(ray_start):
    """Test tools execute as distributed Ray tasks."""

    @ray.remote(num_cpus=1)
    def cpu_tool():
        import os

        return f"Executed on PID {os.getpid()}"

    @ray.remote(num_cpus=1)
    def another_cpu_tool():
        import os

        return f"Executed on PID {os.getpid()}"

    adapter = MockAdapter()
    session = AgentSession.remote(session_id="test", adapter=adapter)

    # Execute with multiple tools
    result = ray.get(session.run.remote("Test", tools=[cpu_tool, another_cpu_tool]))

    # Verify tools executed (potentially on different workers)
    assert "tool_results" in result
    assert len(result["tool_results"]) == 2
    # Both should have executed and returned PID info
    assert all("PID" in str(r) for r in result["tool_results"])


def test_tool_with_resource_requirements(ray_start):
    """Test tools with specific resource requirements."""

    @ray.remote(num_cpus=2, memory=1024 * 1024 * 1024)
    def resource_intensive_tool():
        return "Processed with 2 CPUs and 1GB memory"

    adapter = MockAdapter()
    session = AgentSession.remote(session_id="test", adapter=adapter)

    # Execute tool with resource requirements
    result = ray.get(session.run.remote("Test", tools=[resource_intensive_tool]))

    # Verify tool executed successfully
    assert "tool_results" in result
    assert len(result["tool_results"]) == 1
    assert "Processed" in result["tool_results"][0]
