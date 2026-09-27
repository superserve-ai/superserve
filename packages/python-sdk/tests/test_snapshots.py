"""Tests for Snapshot, Sandbox.snapshot(), and create-from-snapshot — sync."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest
import respx
from superserve import (
    Sandbox,
    SandboxError,
    SandboxTimeoutError,
    Snapshot,
    SnapshotStatus,
)

API = "https://api.example.com"
SBX = "0b5e6c1a-3f0e-4d7c-9a51-2f8e4c1d7a90"
SNAP = "7c2d9e4f-1a3b-4c5d-8e6f-9a0b1c2d3e4f"


def _snap(status: str = "ready", **extra: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": SNAP,
        "sandbox_id": SBX,
        "template_id": None,
        "kind": "mem+fs",
        "status": status,
        "name": "before-upgrade",
        "size_bytes": 1048576 if status == "ready" else 0,
        "resources": {"vcpu_count": 2, "memory_mib": 2048, "disk_mib": 4096},
        "created_at": "2026-01-01T00:00:00Z",
        "ready_at": "2026-01-01T00:00:05Z" if status == "ready" else None,
    }
    data.update(extra)
    return data


def _sandbox_raw(**extra: Any) -> dict[str, Any]:
    return {
        "id": SBX,
        "name": "test",
        "status": "active",
        "created_at": "2026-01-01T00:00:00Z",
        "access_token": "tok",
        **extra,
    }


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)


def _sandbox(router: respx.MockRouter) -> Sandbox:
    router.post(f"{API}/sandboxes").mock(
        return_value=httpx.Response(201, json=_sandbox_raw())
    )
    return Sandbox.create(name="test")


class TestTakeSnapshot:
    def test_ready_201(self) -> None:
        with respx.mock() as router:
            sbx = _sandbox(router)
            route = router.post(f"{API}/sandboxes/{SBX}/snapshot").mock(
                return_value=httpx.Response(201, json=_snap())
            )
            snap = sbx.snapshot(name="before-upgrade")
            assert isinstance(snap, Snapshot)
            assert snap.status == SnapshotStatus.READY
            assert snap.resources.memory_mib == 2048
            assert snap.size_bytes == 1048576
            body = json.loads(route.calls.last.request.content)
            assert body["kind"] == "mem+fs"
            assert body["name"] == "before-upgrade"
            uuid.UUID(body["idempotency_key"])
            assert route.calls.last.request.headers["X-API-Key"] == "ss_live_key"

    def test_caller_idempotency_key_sent(self) -> None:
        with respx.mock() as router:
            sbx = _sandbox(router)
            route = router.post(f"{API}/sandboxes/{SBX}/snapshot").mock(
                return_value=httpx.Response(200, json=_snap())
            )
            sbx.snapshot(idempotency_key="retry-key-1")
            body = json.loads(route.calls.last.request.content)
            assert body == {"kind": "mem+fs", "idempotency_key": "retry-key-1"}

    def test_202_polled_until_ready(self) -> None:
        with respx.mock() as router:
            sbx = _sandbox(router)
            router.post(f"{API}/sandboxes/{SBX}/snapshot").mock(
                return_value=httpx.Response(202, json=_snap("creating"))
            )
            poll = router.get(f"{API}/snapshots/{SNAP}").mock(
                side_effect=[
                    httpx.Response(200, json=_snap("creating")),
                    httpx.Response(200, json=_snap("ready")),
                ]
            )
            snap = sbx.snapshot(poll_interval_s=0)
            assert snap.status == SnapshotStatus.READY
            assert poll.call_count == 2

    def test_no_wait_returns_creating(self) -> None:
        with respx.mock() as router:
            sbx = _sandbox(router)
            router.post(f"{API}/sandboxes/{SBX}/snapshot").mock(
                return_value=httpx.Response(202, json=_snap("creating"))
            )
            snap = sbx.snapshot(wait=False)
            assert snap.status == SnapshotStatus.CREATING

    def test_failed_while_waiting_raises(self) -> None:
        with respx.mock() as router:
            sbx = _sandbox(router)
            router.post(f"{API}/sandboxes/{SBX}/snapshot").mock(
                return_value=httpx.Response(202, json=_snap("creating"))
            )
            router.get(f"{API}/snapshots/{SNAP}").mock(
                return_value=httpx.Response(200, json=_snap("failed"))
            )
            with pytest.raises(SandboxError, match="failed"):
                sbx.snapshot(poll_interval_s=0)


class TestWaitUntilReady:
    def _creating(self) -> Snapshot:
        with respx.mock() as router:
            router.get(f"{API}/snapshots/{SNAP}").mock(
                return_value=httpx.Response(200, json=_snap("creating"))
            )
            return Snapshot.get(SNAP)

    def test_ready_returns_at_once(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/snapshots/{SNAP}").mock(
                return_value=httpx.Response(200, json=_snap())
            )
            snap = Snapshot.get(SNAP)
            assert snap.wait_until_ready() is snap
            assert router.calls.call_count == 1

    def test_404_while_polling_raises(self) -> None:
        snap = self._creating()
        with respx.mock() as router:
            router.get(f"{API}/snapshots/{SNAP}").mock(
                return_value=httpx.Response(404, json={"error": {"message": "gone"}})
            )
            with pytest.raises(SandboxError, match="was deleted"):
                snap.wait_until_ready(poll_interval_s=0)

    def test_timeout_while_settling(self) -> None:
        snap = self._creating()
        with pytest.raises(SandboxTimeoutError, match="still creating"):
            snap.wait_until_ready(timeout=0.01, poll_interval_s=1)


class TestSnapshotCrud:
    def test_list_with_paging(self) -> None:
        with respx.mock() as router:
            route = router.get(url__startswith=f"{API}/sandboxes/{SBX}/snapshots").mock(
                return_value=httpx.Response(200, json=[_snap(), _snap("creating")])
            )
            infos = Snapshot.list(SBX, limit=10, offset=20)
            assert [i.status for i in infos] == [
                SnapshotStatus.READY,
                SnapshotStatus.CREATING,
            ]
            params = route.calls.last.request.url.params
            assert params["limit"] == "10"
            assert params["offset"] == "20"

    def test_sandbox_snapshots_lists_own(self) -> None:
        with respx.mock() as router:
            sbx = _sandbox(router)
            route = router.get(f"{API}/sandboxes/{SBX}/snapshots").mock(
                return_value=httpx.Response(200, json=[_snap()])
            )
            assert len(sbx.snapshots()) == 1
            assert route.calls.last.request.url.query == b""

    def test_get(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/snapshots/{SNAP}").mock(
                return_value=httpx.Response(200, json=_snap())
            )
            snap = Snapshot.get(SNAP)
            assert snap.id == SNAP
            assert snap.sandbox_id == SBX
            assert snap.template_id is None
            assert snap.ready_at is not None
            assert snap.get_info().name == "before-upgrade"

    def test_rename(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/snapshots/{SNAP}").mock(
                return_value=httpx.Response(200, json=_snap())
            )
            route = router.patch(f"{API}/snapshots/{SNAP}").mock(
                return_value=httpx.Response(200, json=_snap(name="after"))
            )
            snap = Snapshot.get(SNAP)
            renamed = snap.rename("after")
            assert renamed.name == "after"
            assert snap.name == "before-upgrade"
            assert json.loads(route.calls.last.request.content) == {"name": "after"}

    def test_delete_idempotent_on_404(self) -> None:
        with respx.mock() as router:
            router.delete(f"{API}/snapshots/{SNAP}").mock(
                return_value=httpx.Response(404, json={"error": {"message": "gone"}})
            )
            Snapshot.delete_by_id(SNAP)

    def test_delete_accepts_202(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/snapshots/{SNAP}").mock(
                return_value=httpx.Response(200, json=_snap())
            )
            route = router.delete(f"{API}/snapshots/{SNAP}").mock(
                return_value=httpx.Response(202)
            )
            Snapshot.get(SNAP).delete()
            assert route.called


class TestCreateFromSnapshot:
    def test_instance_sends_id(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/snapshots/{SNAP}").mock(
                return_value=httpx.Response(200, json=_snap())
            )
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(
                    201, json=_sandbox_raw(source_snapshot_id=SNAP)
                )
            )
            Sandbox.create(name="fork", from_snapshot=Snapshot.get(SNAP))
            assert json.loads(route.calls.last.request.content) == {
                "name": "fork",
                "from_snapshot": SNAP,
            }

    def test_source_snapshot_id_parsed(self) -> None:
        with respx.mock() as router:
            sbx = _sandbox(router)
            router.get(f"{API}/sandboxes/{SBX}").mock(
                return_value=httpx.Response(
                    200, json=_sandbox_raw(source_snapshot_id=SNAP)
                )
            )
            assert sbx.get_info().source_snapshot_id == SNAP
