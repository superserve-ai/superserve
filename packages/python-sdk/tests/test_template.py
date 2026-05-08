"""Tests for the sync Template class."""

from __future__ import annotations

import httpx
import pytest
import respx
from superserve import Template, TemplateStatus

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


class TestCreate:
    def test_posts_flattened_build_spec(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/templates").mock(
                return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
            )
            t = Template.create(
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

    def test_throws_on_missing_build_id(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/templates").mock(
                return_value=httpx.Response(202, json=BASE)
            )
            with pytest.raises(Exception, match="missing build_id"):
                Template.create(name="x", from_="python:3.11")


class TestConnect:
    def test_gets_template(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/templates/my-env").mock(
                return_value=httpx.Response(200, json=BASE)
            )
            t = Template.connect("my-env")
            assert t.name == "my-env"


class TestList:
    def test_without_filter(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/templates").mock(
                return_value=httpx.Response(200, json=[BASE])
            )
            lst = Template.list()
            assert len(lst) == 1
            assert lst[0].name == "my-env"

    def test_with_name_prefix(self) -> None:
        with respx.mock() as router:
            route = router.get(f"{API}/templates", params={"name_prefix": "my-"}).mock(
                return_value=httpx.Response(200, json=[])
            )
            Template.list(name_prefix="my-")
            assert route.call_count == 1


class TestDeleteById:
    def test_deletes(self) -> None:
        with respx.mock() as router:
            router.delete(f"{API}/templates/my-env").mock(
                return_value=httpx.Response(204)
            )
            Template.delete_by_id("my-env")

    def test_swallows_404(self) -> None:
        with respx.mock() as router:
            router.delete(f"{API}/templates/missing").mock(
                return_value=httpx.Response(
                    404, json={"error": {"code": "not_found", "message": "no"}}
                )
            )
            Template.delete_by_id("missing")  # no exception


class TestInstanceMethods:
    def _make(self, router: respx.MockRouter) -> Template:
        router.post(f"{API}/templates").mock(
            return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
        )
        return Template.create(name="my-env", from_="python:3.11")

    def test_get_info(self) -> None:
        with respx.mock() as router:
            t = self._make(router)
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={**BASE, "status": "ready"})
            )
            info = t.get_info()
            assert info.status == TemplateStatus.READY

    def test_delete_idempotent_404(self) -> None:
        with respx.mock() as router:
            t = self._make(router)
            router.delete(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(
                    404, json={"error": {"code": "not_found", "message": "no"}}
                )
            )
            t.delete()

    def test_rebuild(self) -> None:
        with respx.mock() as router:
            t = self._make(router)
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
            b = t.rebuild()
            assert b.id == "b-2"

    def test_list_builds(self) -> None:
        with respx.mock() as router:
            t = self._make(router)
            router.get(f"{API}/templates/t-1/builds", params={"limit": "5"}).mock(
                return_value=httpx.Response(200, json=[])
            )
            t.list_builds(limit=5)

    def test_cancel_build_idempotent(self) -> None:
        with respx.mock() as router:
            t = self._make(router)
            router.delete(f"{API}/templates/t-1/builds/b-1").mock(
                return_value=httpx.Response(
                    404, json={"error": {"code": "not_found", "message": "no"}}
                )
            )
            t.cancel_build("b-1")
