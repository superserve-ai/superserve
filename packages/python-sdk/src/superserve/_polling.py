"""Polling utility for waiting on sandbox status transitions."""

from __future__ import annotations

import asyncio
import random
import time
from typing import Optional

from ._config import ResolvedConfig
from ._http import api_request, async_api_request
from .errors import SandboxError, SandboxTimeoutError
from .types import SandboxInfo, SandboxStatus, to_sandbox_info


def wait_for_status(
    sandbox_id: str,
    target: SandboxStatus,
    config: ResolvedConfig,
    *,
    timeout_seconds: float = 60.0,
    interval_seconds: float = 1.0,
) -> SandboxInfo:
    """Poll GET /sandboxes/{id} until status matches target."""
    deadline = time.monotonic() + timeout_seconds
    last_status: Optional[str] = None

    while time.monotonic() < deadline:
        raw = api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        last_status = raw.get("status")
        if last_status == target.value:
            return to_sandbox_info(raw)

        # Fail fast on terminal states
        if target.value != "failed" and last_status == "failed":
            raise SandboxError(
                f"Sandbox {sandbox_id} reached 'failed' state before '{target.value}'"
            )
        if target.value != "deleted" and last_status == "deleted":
            raise SandboxError(
                f"Sandbox {sandbox_id} was deleted while waiting for '{target.value}'"
            )

        # Linear poll with ±20% jitter
        jitter = interval_seconds * (0.8 + random.random() * 0.4)
        time.sleep(jitter)

    raise SandboxTimeoutError(
        f"Timed out after {timeout_seconds}s waiting for sandbox {sandbox_id} "
        f'to reach "{target.value}". Last status: "{last_status or "unknown"}".'
    )


async def async_wait_for_status(
    sandbox_id: str,
    target: SandboxStatus,
    config: ResolvedConfig,
    *,
    timeout_seconds: float = 60.0,
    interval_seconds: float = 1.0,
) -> SandboxInfo:
    """Async variant of wait_for_status."""
    deadline = time.monotonic() + timeout_seconds
    last_status: Optional[str] = None

    while time.monotonic() < deadline:
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        last_status = raw.get("status")
        if last_status == target.value:
            return to_sandbox_info(raw)

        if target.value != "failed" and last_status == "failed":
            raise SandboxError(
                f"Sandbox {sandbox_id} reached 'failed' state before '{target.value}'"
            )
        if target.value != "deleted" and last_status == "deleted":
            raise SandboxError(
                f"Sandbox {sandbox_id} was deleted while waiting for '{target.value}'"
            )

        jitter = interval_seconds * (0.8 + random.random() * 0.4)
        await asyncio.sleep(jitter)

    raise SandboxTimeoutError(
        f"Timed out after {timeout_seconds}s waiting for sandbox {sandbox_id} "
        f'to reach "{target.value}". Last status: "{last_status or "unknown"}".'
    )
