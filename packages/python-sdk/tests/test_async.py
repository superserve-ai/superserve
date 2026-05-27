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
        "created_at": "2026-01-01T00:00:00Z",
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

    async def test_kill_swallows_404(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            router.delete(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(404, json={"error": {"message": "gone"}})
            )
            sbx = await AsyncSandbox.connect("sbx-1")
            await sbx.kill()  # Should NOT raise

    async def test_pause_returns_none(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
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
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
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
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
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


class TestAsyncCreateFromTemplate:
    async def test_maps_string(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sbx = await AsyncSandbox.create(
                name="b", from_template="superserve/python-3.11"
            )
            try:
                body = route.calls.last.request.content
                assert b'"from_template"' in body
                assert b"superserve/python-3.11" in body
            finally:
                await sbx._close_http_client()

    async def test_maps_instance(self) -> None:
        from superserve import AsyncTemplate

        with respx.mock() as router:
            router.post(f"{API}/templates").mock(
                return_value=httpx.Response(
                    202,
                    json={
                        "id": "t-1",
                        "team_id": "team-1",
                        "name": "my-env",
                        "status": "building",
                        "vcpu": 1,
                        "memory_mib": 1024,
                        "disk_mib": 4096,
                        "created_at": "2026-01-01T00:00:00Z",
                        "build_id": "b-1",
                    },
                )
            )
            tpl = await AsyncTemplate.create(name="my-env", from_="python:3.11")
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sbx = await AsyncSandbox.create(name="b", from_template=tpl)
            try:
                body = route.calls.last.request.content
                assert (
                    b'"from_template": "my-env"' in body
                    or b'"from_template":"my-env"' in body
                )
            finally:
                await sbx._close_http_client()

    async def test_maps_from_snapshot(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sbx = await AsyncSandbox.create(name="b", from_snapshot="snap-abc")
            try:
                body = route.calls.last.request.content
                assert b"snap-abc" in body
                assert b"from_snapshot" in body
            finally:
                await sbx._close_http_client()


class TestAsyncConcurrentRefresh:
    async def test_serialized_refresh_under_concurrent_401(self) -> None:
        import asyncio

        sbx_id = "sbx-aconc"
        sandbox_host = "sandbox.example.com"
        data_plane = f"https://boxd-{sbx_id}.{sandbox_host}"

        exec_call_count = 0
        activate_call_count = 0

        def exec_response(_request: httpx.Request) -> httpx.Response:
            nonlocal exec_call_count
            exec_call_count += 1
            if exec_call_count <= 2:
                return httpx.Response(
                    401, json={"error": {"code": "auth_failed"}}
                )
            return httpx.Response(
                200, json={"stdout": "ok", "stderr": "", "exit_code": 0}
            )

        async def activate_response(_request: httpx.Request) -> httpx.Response:
            nonlocal activate_call_count
            activate_call_count += 1
            # Yield to event loop — if the lock were missing, both refreshes
            # would interleave here.
            await asyncio.sleep(0.02)
            return httpx.Response(
                200,
                json={
                    "id": sbx_id,
                    "name": "c",
                    "status": "active",
                    "created_at": "2026-01-01T00:00:00Z",
                    "access_token": "tok-refreshed",
                },
            )

        with respx.mock(base_url=API, assert_all_called=False) as router:
            router.post(f"{API}/sandboxes/{sbx_id}/activate").mock(
                side_effect=activate_response
            )
            router.post(f"{data_plane}/exec").mock(side_effect=exec_response)

            sbx = await AsyncSandbox.connect(
                sbx_id, api_key="ss_live_x", base_url=API
            )
            try:
                sbx._config = sbx._config.__class__(
                    api_key=sbx._config.api_key,
                    base_url=sbx._config.base_url,
                    sandbox_host=sandbox_host,
                )
                sbx.commands._data_plane_base_url = data_plane

                a, b = await asyncio.gather(
                    sbx.commands.run("echo a"),
                    sbx.commands.run("echo b"),
                )
                assert a.stdout == "ok"
                assert b.stdout == "ok"
                # connect did 1 + 2 serialized refreshes = 3
                assert activate_call_count == 3
                assert exec_call_count == 4
            finally:
                await sbx._close_http_client()
