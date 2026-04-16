"""
Session-scoped fixtures for the Python SDK e2e test suite.

- `client` / `async_client` — one instance per pytest session
- `run_id` — short, unique per run, used in resource names so orphans
  from crashed runs are identifiable for manual cleanup

After the data-plane files overlay was added, `SuperserveEnvironment` became
a structured object with both `base` (control plane) and `sandbox_data_plane`
(data plane) URLs instead of a flat URL. Clients are now configured via an
environment object rather than a `base_url` kwarg. Override via env vars:

    SUPERSERVE_BASE_URL — control plane host (default: staging)
"""

import os
import random
import string
import time

import pytest

from superserve import AsyncSuperserve, Superserve
from superserve.environment import SuperserveEnvironment


DEFAULT_BASE_URL = "https://api-staging.superserve.ai"
# Placeholder sandbox_data_plane URL — real file ops override this per call
# (TS) or must instantiate a per-sandbox client (Python). Tests that don't
# touch files don't care what this value is.
DEFAULT_SANDBOX_DATA_PLANE = "https://boxd.sandbox.superserve.ai"


@pytest.fixture(scope="session")
def run_id() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"{int(time.time())}{suffix}"


@pytest.fixture(scope="session")
def _environment() -> SuperserveEnvironment:
    base = os.environ.get("SUPERSERVE_BASE_URL", DEFAULT_BASE_URL)
    return SuperserveEnvironment(
        base=base,
        sandbox_data_plane=DEFAULT_SANDBOX_DATA_PLANE,
    )


@pytest.fixture(scope="session")
def client(_environment: SuperserveEnvironment) -> Superserve:
    return Superserve(
        api_key=os.environ["SUPERSERVE_API_KEY"],
        environment=_environment,
    )


@pytest.fixture(scope="session")
def async_client(_environment: SuperserveEnvironment) -> AsyncSuperserve:
    return AsyncSuperserve(
        api_key=os.environ["SUPERSERVE_API_KEY"],
        environment=_environment,
    )
