"""Tests for stream_build_logs and wait_until_ready."""

from __future__ import annotations

import httpx
import pytest
import respx
from superserve import Template
from superserve.errors import BuildError, ConflictError

API = "https://api.example.com"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)


BASE = {
    "id": "t-1",
    "team_id": "team-1",
    "alias": "my-env",
    "status": "building",
    "vcpu": 1,
    "memory_mib": 1024,
    "disk_mib": 4096,
    "created_at": "2026-01-01T00:00:00Z",
}


def _make_template(router: respx.MockRouter) -> Template:
    router.post(f"{API}/templates").mock(
        return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
    )
    return Template.create(alias="my-env", from_="python:3.11")


def _sse_text(events: list[str]) -> str:
    return "".join(f"data: {e}\n\n" for e in events)


class TestStreamBuildLogs:
    def test_forwards_events(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
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
            t.stream_build_logs(on_event=events.append)
            assert len(events) == 2
            assert events[0].text == "hello"

    def test_falls_back_to_list_builds_when_latest_unset(self) -> None:
        # Connect: no build_id in response → latest_build_id is None
        with respx.mock() as router:
            router.get(f"{API}/templates/my-env").mock(
                return_value=httpx.Response(200, json=BASE)
            )
            t = Template.connect("my-env")

            router.get(f"{API}/templates/t-1/builds", params={"limit": "1"}).mock(
                return_value=httpx.Response(
                    200,
                    json=[
                        {
                            "id": "b-recent",
                            "template_id": "t-1",
                            "status": "ready",
                            "build_spec_hash": "h",
                            "created_at": "2026-01-01T00:00:00Z",
                        }
                    ],
                )
            )
            sse = _sse_text(
                [
                    '{"timestamp":"2026-01-01T00:00:00Z","stream":"stdout","text":"hi"}',
                ]
            )
            stream_route = router.get(f"{API}/templates/t-1/builds/b-recent/logs").mock(
                return_value=httpx.Response(200, text=sse)
            )

            t.stream_build_logs(on_event=lambda ev: None)
            assert stream_route.call_count == 1

    def test_raises_helpful_error_when_no_builds(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/templates/my-env").mock(
                return_value=httpx.Response(200, json=BASE)
            )
            t = Template.connect("my-env")
            router.get(f"{API}/templates/t-1/builds", params={"limit": "1"}).mock(
                return_value=httpx.Response(200, json=[])
            )
            with pytest.raises(Exception, match="has no builds"):
                t.stream_build_logs(on_event=lambda ev: None)


class TestWaitUntilReady:
    def test_resolves_on_ready(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            sse = _sse_text(
                [
                    '{"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"ok","finished":true,"status":"ready"}',
                ]
            )
            router.get(f"{API}/templates/t-1/builds/b-1/logs").mock(
                return_value=httpx.Response(200, text=sse)
            )
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={**BASE, "status": "ready"})
            )
            info = t.wait_until_ready()
            assert info.status.value == "ready"

    def test_raises_build_error_on_failed(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            sse = _sse_text(
                [
                    '{"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"fail","finished":true,"status":"failed"}',
                ]
            )
            router.get(f"{API}/templates/t-1/builds/b-1/logs").mock(
                return_value=httpx.Response(200, text=sse)
            )
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        **BASE,
                        "status": "failed",
                        "error_message": "step_failed: step 1/1 failed",
                    },
                )
            )
            with pytest.raises(BuildError) as exc:
                t.wait_until_ready()
            assert exc.value.code == "step_failed"
            assert exc.value.build_id == "b-1"
            assert exc.value.template_id == "t-1"

    def test_raises_conflict_on_cancelled(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            sse = _sse_text(
                [
                    '{"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"cx","finished":true,"status":"cancelled"}',
                ]
            )
            router.get(f"{API}/templates/t-1/builds/b-1/logs").mock(
                return_value=httpx.Response(200, text=sse)
            )
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={**BASE, "status": "failed"})
            )
            with pytest.raises(ConflictError):
                t.wait_until_ready()
