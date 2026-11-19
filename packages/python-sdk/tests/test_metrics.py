"""Metrics reads stay on the authenticated control plane for inactive VMs."""

from __future__ import annotations

import inspect
from datetime import datetime, timezone

import httpx
import pytest
import respx
from superserve import (
    AsyncSandbox,
    AuthenticationError,
    NotFoundError,
    Sandbox,
    SandboxCpuUsage,
    SandboxDiskUsage,
    SandboxMemoryUsage,
    SandboxMetrics,
    ServerError,
    async_connection_pool,
)
from superserve import _http
from superserve._config import resolve_config
from superserve.types import SandboxInfo

API = "https://api.example.com"
KEY = "ss_test_metrics"
ID = "sbx-metrics"


def metrics(status="paused"):
    return {
        "id": ID,
        "status": status,
        "cpu": {
            "configured_vcpus": 2,
            "effective_vcpus": None,
            "limit_vcpus": 4,
            "usage": {
                "used_vcpus": 0,
                "sampled_at": "2026-01-01T00:00:01.123Z",
                "window_seconds": 1.25,
                "source": "last_known",
            },
        },
        "memory": {
            "configured_bytes": 536870912,
            "effective_bytes": 0,
            "limit_bytes": 1073741824,
            "usage": {
                "used_bytes": 0,
                "sampled_at": "2026-01-01T00:00:02.456Z",
                "source": "live",
            },
        },
        "disk": {
            "configured_bytes": 2147483648,
            "effective_bytes": None,
            "limit_bytes": 2147483648,
            "usage": {
                "total_bytes": 2000000000,
                "used_bytes": 0,
                "available_bytes": 1900000000,
                "sampled_at": "2025-12-31T23:59:59.789Z",
                "source": "last_known",
            },
        },
    }


def check_model(result):
    assert isinstance(result, SandboxMetrics)
    assert isinstance(result.cpu.usage, SandboxCpuUsage)
    assert result.cpu.usage.used_vcpus == 0
    assert result.cpu.usage.window_seconds == 1.25
    assert result.cpu.effective_vcpus is None
    assert result.cpu.usage.source == "last_known"
    assert result.cpu.usage.sampled_at == datetime(
        2026, 1, 1, 0, 0, 1, 123000, tzinfo=timezone.utc
    )
    assert isinstance(result.memory.usage, SandboxMemoryUsage)
    assert result.memory.usage.used_bytes == 0
    assert result.memory.effective_bytes == 0
    assert result.memory.usage.source == "live"
    assert result.memory.usage.sampled_at == datetime(
        2026, 1, 1, 0, 0, 2, 456000, tzinfo=timezone.utc
    )
    assert isinstance(result.disk.usage, SandboxDiskUsage)
    assert result.disk.usage.used_bytes == 0
    assert result.disk.usage.total_bytes == 2000000000
    assert result.disk.usage.available_bytes == 1900000000
    assert result.disk.effective_bytes is None
    assert result.disk.usage.sampled_at == datetime(
        2025, 12, 31, 23, 59, 59, 789000, tzinfo=timezone.utc
    )


def check_request(router):
    assert len(router.calls) == 1
    request = router.calls[0].request
    assert request.method == "GET"
    assert str(request.url) == f"{API}/sandboxes/{ID}/metrics"
    assert request.headers["X-API-Key"] == KEY
    assert "authorization" not in request.headers


@pytest.mark.parametrize("status", ["paused", "failed"])
def test_sync_by_id_reads_inactive_without_activation(status):
    with respx.mock() as router:
        router.get(f"{API}/sandboxes/{ID}/metrics").respond(200, json=metrics(status))
        result = Sandbox.get_metrics_by_id(ID, api_key=KEY, base_url=API)
        check_request(router)
        check_model(result)
        assert result.status == status


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["paused", "failed"])
async def test_async_by_id_reads_inactive_without_activation(status):
    assert inspect.iscoroutinefunction(AsyncSandbox.get_metrics_by_id)
    assert inspect.iscoroutinefunction(AsyncSandbox.get_metrics)
    with respx.mock() as router:
        router.get(f"{API}/sandboxes/{ID}/metrics").respond(200, json=metrics(status))
        result = await AsyncSandbox.get_metrics_by_id(ID, api_key=KEY, base_url=API)
        check_request(router)
        check_model(result)
        assert result.status == status


@pytest.mark.parametrize("resource", ["cpu", "memory", "disk"])
def test_nullable_observations_are_independent(resource):
    raw = metrics()
    raw[resource]["usage"] = None
    result = SandboxMetrics.model_validate(raw)
    assert getattr(result, resource).usage is None
    for other in {"cpu", "memory", "disk"} - {resource}:
        assert getattr(result, other).usage is not None


def test_all_usage_and_effective_values_can_be_unknown():
    raw = metrics()
    for resource in ("cpu", "memory", "disk"):
        raw[resource]["usage"] = None
        raw[resource]["effective_vcpus" if resource == "cpu" else "effective_bytes"] = (
            None
        )
    result = SandboxMetrics.model_validate(raw)
    assert result.cpu.usage is result.memory.usage is result.disk.usage is None
    assert (
        result.cpu.effective_vcpus
        is result.memory.effective_bytes
        is result.disk.effective_bytes
        is None
    )


@pytest.mark.parametrize(
    "status,error",
    [(401, AuthenticationError), (404, NotFoundError), (500, ServerError)],
)
def test_existing_sync_typed_errors_propagate(status, error):
    with respx.mock() as router:
        router.get(f"{API}/sandboxes/{ID}/metrics").respond(
            status, json={"error": {"message": "unavailable"}}
        )
        with pytest.raises(error):
            Sandbox.get_metrics_by_id(ID, api_key=KEY, base_url=API)
        check_request(router)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,error",
    [(401, AuthenticationError), (404, NotFoundError), (500, ServerError)],
)
async def test_existing_async_typed_errors_propagate(status, error):
    with respx.mock() as router:
        router.get(f"{API}/sandboxes/{ID}/metrics").respond(
            status, json={"error": {"message": "unavailable"}}
        )
        with pytest.raises(error):
            await AsyncSandbox.get_metrics_by_id(ID, api_key=KEY, base_url=API)
        check_request(router)


def handle(cls):
    info = SandboxInfo(
        id=ID, name="test", status="paused", created_at="2026-01-01T00:00:00Z"
    )
    return cls(
        info, "expired-data-plane-token", resolve_config(api_key=KEY, base_url=API)
    )


def test_sync_instance_uses_shared_client_and_never_refreshes(monkeypatch):
    sandbox = handle(Sandbox)
    client = _http.shared_client()
    with respx.mock() as router:
        router.get(f"{API}/sandboxes/{ID}/metrics").respond(200, json=metrics("failed"))
        check_model(sandbox.get_metrics())
        check_request(router)
        assert sandbox._http_client is client


@pytest.mark.asyncio
async def test_async_instance_reuses_its_client():
    sandbox = handle(AsyncSandbox)
    client = sandbox._http_client
    try:
        with respx.mock() as router:
            route = router.get(f"{API}/sandboxes/{ID}/metrics").respond(
                200, json=metrics("failed")
            )
            for _ in range(3):
                check_model(await sandbox.get_metrics())
            assert route.call_count == len(router.calls) == 3
            assert sandbox._http_client is client
            assert not client.is_closed
    finally:
        await sandbox._close_http_client()


@pytest.mark.asyncio
async def test_async_by_id_respects_connection_pool(monkeypatch):
    clients = []
    real = httpx.AsyncClient

    def counting(*args, **kwargs):
        client = real(*args, **kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr(_http.httpx, "AsyncClient", counting)
    with respx.mock() as router:
        router.get(f"{API}/sandboxes/{ID}/metrics").respond(200, json=metrics())
        async with async_connection_pool():
            for _ in range(3):
                await AsyncSandbox.get_metrics_by_id(ID, api_key=KEY, base_url=API)
        assert len(clients) == 1
        assert clients[0].is_closed
