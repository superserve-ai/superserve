"""Shared fixtures for superserve tests."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx
import pytest
from superserve import Superserve
from superserve._http import HttpClient

VM_DATA: dict[str, Any] = {
    "id": "vm_abc123",
    "name": "test-vm",
    "status": "RUNNING",
    "vcpu_count": 2,
    "mem_size_mib": 512,
    "ip_address": "172.16.0.2",
    "created_at": "2026-03-22T10:00:00Z",
    "uptime_seconds": 3600,
    "last_checkpoint_at": None,
    "parent_vm_id": None,
    "forked_from_checkpoint_id": None,
}

CHECKPOINT_DATA: dict[str, Any] = {
    "id": "cp_001",
    "vm_id": "vm_abc123",
    "name": "baseline",
    "type": "named",
    "size_bytes": 1024,
    "delta_size_bytes": 256,
    "created_at": "2026-03-22T10:05:00Z",
    "pinned": True,
}


@pytest.fixture()
def mock_vm_data() -> dict[str, Any]:
    return dict(VM_DATA)


@pytest.fixture()
def mock_checkpoint_data() -> dict[str, Any]:
    return dict(CHECKPOINT_DATA)


def make_client(handler: Callable[[httpx.Request], httpx.Response]) -> Superserve:
    """Create a Superserve client whose underlying httpx.Client uses a MockTransport."""
    transport = httpx.MockTransport(handler)
    client = Superserve(api_key="test-key")
    # Replace the internal httpx.Client with one backed by the mock transport.
    client._http._client = httpx.Client(
        headers={"X-API-Key": "test-key", "Content-Type": "application/json"},
        transport=transport,
    )
    return client


def make_http_client(
    handler: Callable[[httpx.Request], httpx.Response],
    api_key: str = "test-key",
) -> HttpClient:
    """Create an HttpClient whose underlying httpx.Client uses a MockTransport."""
    transport = httpx.MockTransport(handler)
    http = HttpClient(api_key, "https://api.superserve.ai")
    http._client = httpx.Client(
        headers={"X-API-Key": api_key, "Content-Type": "application/json"},
        transport=transport,
    )
    return http
