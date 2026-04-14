"""
Session-scoped fixtures for the Python SDK e2e test suite.

- `client` / `async_client` — one instance per pytest session
- `run_id` — short, unique per run, used in resource names so orphans
  from crashed runs are identifiable for manual cleanup
"""

import os
import random
import string
import time

import pytest

from superserve import AsyncSuperserve, Superserve


DEFAULT_BASE_URL = "https://api-staging.superserve.ai"


@pytest.fixture(scope="session")
def run_id() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"{int(time.time())}{suffix}"


@pytest.fixture(scope="session")
def _base_url() -> str:
    return os.environ.get("SUPERSERVE_BASE_URL", DEFAULT_BASE_URL)


@pytest.fixture(scope="session")
def client(_base_url: str) -> Superserve:
    return Superserve(
        api_key=os.environ["SUPERSERVE_API_KEY"],
        base_url=_base_url,
    )


@pytest.fixture(scope="session")
def async_client(_base_url: str) -> AsyncSuperserve:
    return AsyncSuperserve(
        api_key=os.environ["SUPERSERVE_API_KEY"],
        base_url=_base_url,
    )
