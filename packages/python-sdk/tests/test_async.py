"""Smoke tests for AsyncSandbox."""

from __future__ import annotations

import inspect

import httpx
import pytest
import respx
from superserve import AsyncSandbox, SandboxStatus

API = "https://api.example.com"


def _raw(status: str = "active", sbx_id: str = "sbx-1") -> dict:
    return {
        "id": sbx_id,
        "name": "test",
        "status": status,
        "access_token": "tok",
    }


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)


class TestAsyncStaticMethodsAreAsync:
    def test_create_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(AsyncSandbox.create)

    def test_connect_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(AsyncSandbox.connect)

    def test_list_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(AsyncSandbox.list)

    def test_get_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(AsyncSandbox.get)

    def test_kill_by_id_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(AsyncSandbox.kill_by_id)


class TestAsyncSandboxSmoke:
    async def test_create_returns_instance(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sbx = await AsyncSandbox.create(name="x")
            try:
                assert sbx.id == "sbx-1"
                assert sbx.status == SandboxStatus.ACTIVE
            finally:
                await sbx._close_http_client()

    async def test_context_manager_calls_kill(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            del_route = router.delete(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(204)
            )
            async with await AsyncSandbox.create(name="x") as sbx:
                assert sbx.id == "sbx-1"
            assert del_route.call_count == 1

    async def test_kill_swallows_404(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            router.delete(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(404, json={"error": {"message": "gone"}})
            )
            sbx = await AsyncSandbox.connect("sbx-1")
            await sbx.kill()  # Should NOT raise
