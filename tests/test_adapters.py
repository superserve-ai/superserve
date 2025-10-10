"""Tests for AgentAdapter implementations."""

import pytest
import ray

from ray_agents import AgentSession
from ray_agents.adapters import AgentAdapter


def test_adapter_must_return_content_key(ray_start):
    """Test that adapter must return dict with 'content' key."""

    class BadAdapter(AgentAdapter):
        """Adapter that returns invalid response."""

        async def run(self, message, messages, tools):
            return {"response": "missing content key"}

    adapter = BadAdapter()
    session = AgentSession.remote(session_id="test", adapter=adapter)

    # This should raise ValueError
    with pytest.raises(ray.exceptions.RayTaskError) as exc_info:
        ray.get(session.run.remote("Test"))

    # Verify error message mentions 'content' key
    assert "content" in str(exc_info.value).lower()
