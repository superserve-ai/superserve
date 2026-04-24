"""Session-scoped fixtures for the Python SDK e2e test suite."""

import os
import random
import string
import time

import pytest


@pytest.fixture(scope="session")
def run_id() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"{int(time.time())}{suffix}"


@pytest.fixture(scope="session")
def connection_opts():
    return {
        "api_key": os.environ.get("SUPERSERVE_API_KEY"),
        "base_url": os.environ.get(
            "SUPERSERVE_BASE_URL", "https://api-staging.superserve.ai"
        ),
    }
