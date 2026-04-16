"""
Shared helpers for the Python SDK e2e test suite.

- `SKIP_IF_NO_CREDS` — module-level pytest mark. Apply via
  `pytestmark = SKIP_IF_NO_CREDS` at the top of each test file to skip
  every test in the file at collection time when credentials are missing.

- `wait_for_status` / `async_wait_for_status` — poll `get_sandbox` until
  the sandbox reaches a target status, or raise `TimeoutError`. Lifecycle
  transitions (starting → active, active → pausing → idle, idle →
  starting → active on resume) aren't instantaneous, so tests that
  exercise these transitions poll instead of sleeping.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Optional

import pytest

from superserve import AsyncSuperserve, Superserve


SKIP_IF_NO_CREDS = pytest.mark.skipif(
    not os.environ.get("SUPERSERVE_API_KEY"),
    reason="SUPERSERVE_API_KEY not set; skipping e2e tests",
)


def wait_for_status(
    client: Superserve,
    sandbox_id: str,
    expected: str,  # accepts any status string (e.g. "paused" — spec drift)
    *,
    timeout_s: float = 60.0,
    interval_s: float = 2.0,
):
    """Poll `get_sandbox` until the sandbox reaches `expected`, or raise."""
    deadline = time.monotonic() + timeout_s
    last_status: Optional[str] = None
    while time.monotonic() < deadline:
        sandbox = client.sandboxes.get_sandbox(sandbox_id)
        last_status = sandbox.status
        if sandbox.status == expected:
            return sandbox
        time.sleep(interval_s)
    raise TimeoutError(
        f"Timed out after {timeout_s}s waiting for sandbox {sandbox_id} "
        f"to reach status {expected!r}. Last observed: {last_status!r}."
    )


async def async_wait_for_status(
    client: AsyncSuperserve,
    sandbox_id: str,
    expected: str,
    *,
    timeout_s: float = 60.0,
    interval_s: float = 2.0,
):
    """Async variant of `wait_for_status` for `AsyncSuperserve`."""
    deadline = time.monotonic() + timeout_s
    last_status: Optional[str] = None
    while time.monotonic() < deadline:
        sandbox = await client.sandboxes.get_sandbox(sandbox_id)
        last_status = sandbox.status
        if sandbox.status == expected:
            return sandbox
        await asyncio.sleep(interval_s)
    raise TimeoutError(
        f"Timed out after {timeout_s}s waiting for sandbox {sandbox_id} "
        f"to reach status {expected!r}. Last observed: {last_status!r}."
    )
