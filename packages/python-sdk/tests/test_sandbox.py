"""Tests for the Sandbox class — sync."""

from __future__ import annotations

import httpx
import pytest
import respx
from superserve import Sandbox, SandboxError, SandboxStatus

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
                # access_token stored privately
                assert sandbox._access_token == "tok"
            finally:
                sandbox._close_http_client()

    def test_missing_access_token_raises(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw(access_token=None))
            )
            with pytest.raises(SandboxError, match="access_token"):
                Sandbox.create(name="my-box")


class TestConnect:
    def test_gets_and_returns_instance(self) -> None:
        with respx.mock() as router:
            route = router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sandbox = Sandbox.connect("sbx-1")
            try:
                assert sandbox.id == "sbx-1"
                assert sandbox._access_token == "tok"
                assert route.call_count == 1
            finally:
                sandbox._close_http_client()

    def test_missing_access_token_raises(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw(access_token=None))
            )
            with pytest.raises(SandboxError, match="access_token"):
                Sandbox.connect("sbx-1")


class TestList:
    def test_returns_list(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes").mock(
                return_value=httpx.Response(
                    200,
                    json=[
                        _raw(sbx_id="a", access_token=None),
                        _raw(sbx_id="b", access_token=None),
                    ],
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
                # access_token must NOT leak into repr
                assert "tok" not in r
            finally:
                sandbox._close_http_client()

    def test_pause_returns_none(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            pause_route = router.post(f"{API}/sandboxes/sbx-1/pause").mock(
                return_value=httpx.Response(204)
            )
            sbx = Sandbox.connect("sbx-1")
            try:
                result = sbx.pause()
                assert result is None
                assert pause_route.call_count == 1
            finally:
                sbx._close_http_client()

    def test_resume_rotates_token_and_rebuilds_files(self) -> None:
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
            sbx = Sandbox.connect("sbx-1")
            try:
                old_files = sbx.files
                result = sbx.resume()
                assert result is None
                assert sbx._access_token == "rotated-tok"
                # files sub-module rebuilt
                assert sbx.files is not old_files
            finally:
                sbx._close_http_client()

    def test_resume_missing_access_token_raises(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            router.post(f"{API}/sandboxes/sbx-1/resume").mock(
                return_value=httpx.Response(
                    200, json={"id": "sbx-1", "status": "active"}
                )
            )
            sbx = Sandbox.connect("sbx-1")
            try:
                with pytest.raises(SandboxError, match="access_token"):
                    sbx.resume()
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
                assert route.call_count == 1
                # metadata is a readonly snapshot; callers must use get_info()
                # for fresh data. This matches the TS SDK contract.
                assert sbx.metadata == {}
            finally:
                sbx._close_http_client()
