"""Shared helpers for the Python SDK e2e test suite."""

import os

import pytest

SKIP_IF_NO_CREDS = pytest.mark.skipif(
    not os.environ.get("SUPERSERVE_API_KEY"),
    reason="SUPERSERVE_API_KEY not set; skipping e2e tests",
)
