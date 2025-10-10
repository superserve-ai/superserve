"""Tests for AgentSession conversation history management."""

import ray

from ray_agents import AgentSession
from ray_agents.adapters import _MockAdapter as MockAdapter


def test_agent_session_conversation_history(ray_start):
    """Test conversation history is maintained."""
    adapter = MockAdapter()
    session = AgentSession.remote(session_id="test", adapter=adapter)

    # Send multiple messages
    ray.get(session.run.remote("First message"))
    ray.get(session.run.remote("Second message"))
    ray.get(session.run.remote("Third message"))

    # Get history
    history = ray.get(session.get_history.remote())

    # Verify history structure
    assert len(history) == 6  # 3 user + 3 assistant messages
    assert history[0]["role"] == "user"
    assert history[0]["content"] == "First message"
    assert history[1]["role"] == "assistant"
    assert history[2]["role"] == "user"
    assert history[2]["content"] == "Second message"


def test_agent_session_clear_history(ray_start):
    """Test clearing conversation history."""
    adapter = MockAdapter()
    session = AgentSession.remote(session_id="test", adapter=adapter)

    # Send messages
    ray.get(session.run.remote("Message 1"))
    ray.get(session.run.remote("Message 2"))

    # Clear history
    ray.get(session.clear_history.remote())

    # Verify history is empty
    history = ray.get(session.get_history.remote())
    assert len(history) == 0
