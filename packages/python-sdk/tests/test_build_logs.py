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

BUILD_BASE = {
    "id": "b-1",
    "template_id": "t-1",
    "build_spec_hash": "h",
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
    def test_resolves_when_build_poll_returns_ready(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            router.get(f"{API}/templates/t-1/builds/b-1").mock(
                return_value=httpx.Response(
                    200, json={**BUILD_BASE, "status": "ready"}
                )
            )
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={**BASE, "status": "ready"})
            )
            info = t.wait_until_ready(poll_interval_s=0.001)
            assert info.status.value == "ready"

    def test_forwards_sse_log_events_through_on_log(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            sse = _sse_text(
                [
                    '{"timestamp":"2026-01-01T00:00:00Z","stream":"stdout","text":"built"}',
                    '{"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"done","finished":true,"status":"ready"}',
                ]
            )
            router.get(f"{API}/templates/t-1/builds/b-1/logs").mock(
                return_value=httpx.Response(200, text=sse)
            )
            router.get(f"{API}/templates/t-1/builds/b-1").mock(
                return_value=httpx.Response(
                    200, json={**BUILD_BASE, "status": "ready"}
                )
            )
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={**BASE, "status": "ready"})
            )
            logs: list = []
            info = t.wait_until_ready(poll_interval_s=0.001, on_log=logs.append)
            assert info.status.value == "ready"
            assert any(ev.text == "built" for ev in logs)

    def test_ignores_sse_ready_while_build_poll_says_building(self) -> None:
        # Regression: SSE sends `finished:true,status:"ready"` the instant
        # vmd finishes, but the DB row that POST /sandboxes reads is updated
        # by a separate ~1s poller. The SDK must trust the build poll, not
        # the SSE event — otherwise callers race to POST /sandboxes and hit
        # 409 "template is not ready".
        with respx.mock() as router:
            t = _make_template(router)
            sse = _sse_text(
                [
                    '{"timestamp":"2026-01-01T00:00:00Z","stream":"system","text":"done","finished":true,"status":"ready"}',
                ]
            )
            router.get(f"{API}/templates/t-1/builds/b-1/logs").mock(
                return_value=httpx.Response(200, text=sse)
            )
            # First two polls: still building. Third: ready.
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
            info = t.wait_until_ready(
                poll_interval_s=0.001, on_log=lambda ev: None
            )
            assert info.status.value == "ready"

    def test_raises_build_error_on_failed(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            router.get(f"{API}/templates/t-1/builds/b-1").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        **BUILD_BASE,
                        "status": "failed",
                        "error_message": "step_failed: step 1/1 failed",
                    },
                )
            )
            with pytest.raises(BuildError) as exc:
                t.wait_until_ready(poll_interval_s=0.001)
            assert exc.value.code == "step_failed"
            assert exc.value.build_id == "b-1"
            assert exc.value.template_id == "t-1"

    def test_raises_conflict_on_cancelled(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            router.get(f"{API}/templates/t-1/builds/b-1").mock(
                return_value=httpx.Response(
                    200, json={**BUILD_BASE, "status": "cancelled"}
                )
            )
            with pytest.raises(ConflictError):
                t.wait_until_ready(poll_interval_s=0.001)

    def test_sse_failure_is_non_fatal(self) -> None:
        # SSE returns 500 — polling still drives terminal detection.
        with respx.mock() as router:
            t = _make_template(router)
            router.get(f"{API}/templates/t-1/builds/b-1/logs").mock(
                return_value=httpx.Response(500)
            )
            router.get(f"{API}/templates/t-1/builds/b-1").mock(
                return_value=httpx.Response(
                    200, json={**BUILD_BASE, "status": "ready"}
                )
            )
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={**BASE, "status": "ready"})
            )
            info = t.wait_until_ready(
                poll_interval_s=0.001, on_log=lambda ev: None
            )
            assert info.status.value == "ready"

    def test_build_error_separates_code_when_prefixed(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            router.get(f"{API}/templates/t-1/builds/b-1").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        **BUILD_BASE,
                        "status": "failed",
                        "error_message": "image_too_large: image is too large for the requested disk_mib",
                    },
                )
            )
            with pytest.raises(BuildError) as exc:
                t.wait_until_ready(poll_interval_s=0.001)
            assert exc.value.code == "image_too_large"
            assert str(exc.value) == "image is too large for the requested disk_mib"

    def test_build_error_uses_generic_message_when_missing(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            router.get(f"{API}/templates/t-1/builds/b-1").mock(
                return_value=httpx.Response(
                    200, json={**BUILD_BASE, "status": "failed"}
                )
            )
            with pytest.raises(BuildError) as exc:
                t.wait_until_ready(poll_interval_s=0.001)
            assert exc.value.code == "build_failed"
            assert str(exc.value) == "Template build failed"
