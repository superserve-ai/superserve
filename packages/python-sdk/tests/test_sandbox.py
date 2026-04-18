"""Tests for the Sandbox class — sync."""

from __future__ import annotations

import httpx
import pytest
import respx

from superserve import Sandbox, SandboxStatus


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


class TestCreate:
    def test_posts_and_returns_instance(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sandbox = Sandbox.create(name="my-box")
            try:
                assert sandbox.id == "sbx-1"
                assert sandbox.name == "test"
                assert sandbox.status == SandboxStatus.ACTIVE
                assert route.call_count == 1
                # body has name
                assert b"my-box" in route.calls.last.request.content
            finally:
                sandbox._close_http_client()


class TestConnect:
    def test_gets_and_returns_instance(self) -> None:
        with respx.mock() as router:
            route = router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sandbox = Sandbox.connect("sbx-1")
            try:
                assert sandbox.id == "sbx-1"
                assert route.call_count == 1
            finally:
                sandbox._close_http_client()


class TestList:
    def test_returns_list(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes").mock(
                return_value=httpx.Response(
                    200, json=[_raw(sbx_id="a"), _raw(sbx_id="b")]
                )
            )
            infos = Sandbox.list()
            assert len(infos) == 2
            assert infos[0].id == "a"
            assert infos[1].id == "b"

    def test_passes_metadata_filter(self) -> None:
        with respx.mock() as router:
            route = router.get(url__regex=rf"{API}/sandboxes.*").mock(
                return_value=httpx.Response(200, json=[])
            )
            Sandbox.list(metadata={"env": "prod"})
            assert "metadata.env=prod" in str(route.calls.last.request.url)


class TestKillById:
    def test_success(self) -> None:
        with respx.mock() as router:
            router.delete(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(204)
            )
            Sandbox.kill_by_id("sbx-1")

    def test_swallows_404(self) -> None:
        with respx.mock() as router:
            router.delete(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(404, json={"error": {"message": "gone"}})
            )
            # should NOT raise
            Sandbox.kill_by_id("sbx-1")


class TestInstanceMethods:
    def test_kill_swallows_404(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            router.delete(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(404, json={"error": {"message": "gone"}})
            )
            sandbox = Sandbox.connect("sbx-1")
            # Should not raise
            sandbox.kill()

    def test_context_manager_calls_kill(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            delete_route = router.delete(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(204)
            )
            with Sandbox.create(name="x") as sbx:
                assert sbx.id == "sbx-1"
            assert delete_route.call_count == 1

    def test_repr_includes_id_and_status(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sandbox = Sandbox.connect("sbx-1")
            try:
                r = repr(sandbox)
                assert "sbx-1" in r
                assert "active" in r
            finally:
                sandbox._close_http_client()

    def test_pause(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            router.post(f"{API}/sandboxes/sbx-1/pause").mock(
                return_value=httpx.Response(200, json=_raw(status="idle"))
            )
            sbx = Sandbox.connect("sbx-1")
            try:
                info = sbx.pause()
                assert info.status == SandboxStatus.IDLE
            finally:
                sbx._close_http_client()

    def test_update_metadata(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            route = router.patch(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(204)
            )
            sbx = Sandbox.connect("sbx-1")
            try:
                sbx.update(metadata={"env": "prod"})
                assert sbx.metadata == {"env": "prod"}
                assert route.call_count == 1
            finally:
                sbx._close_http_client()
