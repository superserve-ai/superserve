"""Tests for the AsyncTemplate class."""

from __future__ import annotations

import inspect

import httpx
import pytest
import respx
from superserve import AsyncTemplate, TemplateStatus
from superserve.errors import BuildError

API = "https://api.example.com"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)


BASE = {
    "id": "t-1",
    "team_id": "team-1",
    "name": "my-env",
    "status": "building",
    "vcpu": 1,
    "memory_mib": 1024,
    "disk_mib": 4096,
    "created_at": "2026-01-01T00:00:00Z",
}


def _sse_text(events: list[str]) -> str:
    return "".join(f"data: {e}\n\n" for e in events)


class TestAsyncStaticMethodsAreAsync:
    def test_create_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(AsyncTemplate.create)

    def test_connect_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(AsyncTemplate.connect)

    def test_list_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(AsyncTemplate.list)

    def test_delete_by_id_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(AsyncTemplate.delete_by_id)


class TestAsyncCreate:
    async def test_posts_flattened_build_spec(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/templates").mock(
                return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
            )
            t = await AsyncTemplate.create(
                name="my-env",
                vcpu=2,
                memory_mib=2048,
                disk_mib=4096,
                from_="python:3.11",
                start_cmd="python server.py",
            )
            assert t.id == "t-1"
            assert t.latest_build_id == "b-1"
            body = route.calls.last.request.content
            assert b"python:3.11" in body
            assert b"start_cmd" in body
            assert b"vcpu" in body

    async def test_throws_on_missing_build_id(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/templates").mock(
                return_value=httpx.Response(202, json=BASE)
            )
            with pytest.raises(Exception, match="missing build_id"):
                await AsyncTemplate.create(name="x", from_="python:3.11")


class TestAsyncConnect:
    async def test_gets_template(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/templates/my-env").mock(
                return_value=httpx.Response(200, json=BASE)
            )
            t = await AsyncTemplate.connect("my-env")
            assert t.name == "my-env"


class TestAsyncList:
    async def test_without_filter(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/templates").mock(
                return_value=httpx.Response(200, json=[BASE])
            )
            lst = await AsyncTemplate.list()
            assert len(lst) == 1
            assert lst[0].name == "my-env"

    async def test_with_name_prefix(self) -> None:
        with respx.mock() as router:
            route = router.get(f"{API}/templates", params={"name_prefix": "my-"}).mock(
                return_value=httpx.Response(200, json=[])
            )
            await AsyncTemplate.list(name_prefix="my-")
            assert route.call_count == 1


class TestAsyncDeleteById:
    async def test_deletes(self) -> None:
        with respx.mock() as router:
            router.delete(f"{API}/templates/my-env").mock(
                return_value=httpx.Response(204)
            )
            await AsyncTemplate.delete_by_id("my-env")

    async def test_swallows_404(self) -> None:
        with respx.mock() as router:
            router.delete(f"{API}/templates/missing").mock(
                return_value=httpx.Response(
                    404, json={"error": {"code": "not_found", "message": "no"}}
                )
            )
            await AsyncTemplate.delete_by_id("missing")  # no exception


class TestAsyncInstanceMethods:
    async def _make(self, router: respx.MockRouter) -> AsyncTemplate:
        router.post(f"{API}/templates").mock(
            return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
        )
        return await AsyncTemplate.create(name="my-env", from_="python:3.11")

    async def test_get_info(self) -> None:
        with respx.mock() as router:
            t = await self._make(router)
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={**BASE, "status": "ready"})
            )
            info = await t.get_info()
            assert info.status == TemplateStatus.READY

    async def test_delete_idempotent_404(self) -> None:
        with respx.mock() as router:
            t = await self._make(router)
            router.delete(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(
                    404, json={"error": {"code": "not_found", "message": "no"}}
                )
            )
            await t.delete()

    async def test_rebuild(self) -> None:
        with respx.mock() as router:
            t = await self._make(router)
            build = {
                "id": "b-2",
                "template_id": "t-1",
                "status": "building",
                "build_spec_hash": "h",
                "created_at": "2026-01-01T00:00:00Z",
            }
            router.post(f"{API}/templates/t-1/builds").mock(
                return_value=httpx.Response(201, json=build)
            )
            b = await t.rebuild()
            assert b.id == "b-2"

    async def test_list_builds(self) -> None:
        with respx.mock() as router:
            t = await self._make(router)
            router.get(f"{API}/templates/t-1/builds", params={"limit": "5"}).mock(
                return_value=httpx.Response(200, json=[])
            )
            await t.list_builds(limit=5)

    async def test_cancel_build_idempotent(self) -> None:
        with respx.mock() as router:
            t = await self._make(router)
            router.delete(f"{API}/templates/t-1/builds/b-1").mock(
                return_value=httpx.Response(
                    404, json={"error": {"code": "not_found", "message": "no"}}
                )
            )
            await t.cancel_build("b-1")


class TestAsyncStreamBuildLogs:
    async def test_forwards_events(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/templates").mock(
                return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
            )
            t = await AsyncTemplate.create(name="my-env", from_="python:3.11")
            sse = _sse_text(
                [
                    '{"timestamp":"2026-01-01T00:00:00Z","stream":"stdout","text":"hello"}',
                    '{"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"done","finished":true,"status":"ready"}',
                ]
            )
            router.get(f"{API}/templates/t-1/builds/b-1/logs").mock(
                return_value=httpx.Response(200, text=sse)
            )
            events: list = []
            await t.stream_build_logs(on_event=events.append)
            assert len(events) == 2


BUILD_BASE = {
    "id": "b-1",
    "template_id": "t-1",
    "build_spec_hash": "h",
    "created_at": "2026-01-01T00:00:00Z",
}


class TestAsyncWaitUntilReady:
    async def test_resolves_when_build_poll_returns_ready(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/templates").mock(
                return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
            )
            t = await AsyncTemplate.create(name="my-env", from_="python:3.11")
            router.get(f"{API}/templates/t-1/builds/b-1").mock(
                return_value=httpx.Response(
                    200, json={**BUILD_BASE, "status": "ready"}
                )
            )
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={**BASE, "status": "ready"})
            )
            info = await t.wait_until_ready(poll_interval_s=0.001)
            assert info.status == TemplateStatus.READY

    async def test_ignores_sse_ready_while_build_poll_says_building(self) -> None:
        # Regression: SSE sends `finished:true,status:"ready"` the instant
        # vmd finishes, but the DB row that POST /sandboxes reads is updated
        # by a separate ~1s poller. The SDK must trust the build poll, not
        # the SSE event — otherwise callers race to POST /sandboxes and hit
        # 409 "template is not ready".
        with respx.mock() as router:
            router.post(f"{API}/templates").mock(
                return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
            )
            t = await AsyncTemplate.create(name="my-env", from_="python:3.11")
            sse = _sse_text(
                [
                    '{"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"done","finished":true,"status":"ready"}',
                ]
            )
            router.get(f"{API}/templates/t-1/builds/b-1/logs").mock(
                return_value=httpx.Response(200, text=sse)
            )
            router.get(f"{API}/templates/t-1/builds/b-1").mock(
                side_effect=[
                    httpx.Response(200, json={**BUILD_BASE, "status": "building"}),
                    httpx.Response(200, json={**BUILD_BASE, "status": "building"}),
                    httpx.Response(200, json={**BUILD_BASE, "status": "ready"}),
                ]
            )
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={**BASE, "status": "ready"})
            )
            info = await t.wait_until_ready(
                poll_interval_s=0.001, on_log=lambda ev: None
            )
            assert info.status == TemplateStatus.READY

    async def test_raises_build_error_on_failed(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/templates").mock(
                return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
            )
            t = await AsyncTemplate.create(name="my-env", from_="python:3.11")
            router.get(f"{API}/templates/t-1/builds/b-1").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        **BUILD_BASE,
                        "status": "failed",
                        "error_message": "step_failed: boom",
                    },
                )
            )
            with pytest.raises(BuildError) as exc:
                await t.wait_until_ready(poll_interval_s=0.001)
            assert exc.value.code == "step_failed"
