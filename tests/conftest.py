"""Shared fixtures for ray_agents tests."""

import pytest
import ray


@pytest.fixture
def ray_start():
    """Start Ray for testing."""

    # The package should already be installed in the environment (via uv/pip install -e .)
    ray.init(ignore_reinit_error=True, num_cpus=4)
    yield
    ray.shutdown()
