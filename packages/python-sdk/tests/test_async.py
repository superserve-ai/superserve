"""Smoke tests for AsyncSandbox."""

from __future__ import annotations

import inspect

import httpx
import pytest
import respx
from superserve import AsyncSandbox, SandboxError, SandboxStatus

API = "https://api.example.com"


def _raw(
    status: str = "active",
    sbx_id: str = "sbx-1",
    access_token: str | None = "tok",
) -> dict:
    data: dict = {
        "id": sbx_id,
        "name": "test",
        "status": status,
    }
    if access_token is not None:
        data["access_token"] = access_token
    return data


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
                assert sbx._access_token == "tok"
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

    async def test_pause_returns_none(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            pause_route = router.post(f"{API}/sandboxes/sbx-1/pause").mock(
                return_value=httpx.Response(204)
            )
            sbx = await AsyncSandbox.connect("sbx-1")
            try:
                result = await sbx.pause()
                assert result is None
                assert pause_route.call_count == 1
            finally:
                await sbx._close_http_client()

    async def test_resume_rotates_token_and_rebuilds_files(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            router.post(f"{API}/sandboxes/sbx-1/resume").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "id": "sbx-1",
                        "status": "active",
                        "access_token": "rotated-tok",
                    },
                )
            )
            sbx = await AsyncSandbox.connect("sbx-1")
            try:
                old_files = sbx.files
                result = await sbx.resume()
                assert result is None
                assert sbx._access_token == "rotated-tok"
                assert sbx.files is not old_files
            finally:
                await sbx._close_http_client()

    async def test_resume_missing_access_token_raises(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            router.post(f"{API}/sandboxes/sbx-1/resume").mock(
                return_value=httpx.Response(
                    200, json={"id": "sbx-1", "status": "active"}
                )
            )
            sbx = await AsyncSandbox.connect("sbx-1")
            try:
                with pytest.raises(SandboxError, match="access_token"):
                    await sbx.resume()
            finally:
                await sbx._close_http_client()
