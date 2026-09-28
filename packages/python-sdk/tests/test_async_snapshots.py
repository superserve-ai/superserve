"""Tests for AsyncSnapshot and AsyncSandbox.snapshot()."""

from __future__ import annotations

import json
import uuid

import httpx
import pytest
import respx
from superserve import AsyncSandbox, AsyncSnapshot, SandboxError, SnapshotStatus

from .test_snapshots import API, SBX, SNAP, _sandbox_raw, _snap


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)


async def _sandbox(router: respx.MockRouter) -> AsyncSandbox:
    router.post(f"{API}/sandboxes").mock(
        return_value=httpx.Response(201, json=_sandbox_raw())
    )
    return await AsyncSandbox.create(name="test")


@pytest.mark.asyncio
async def test_take_snapshot_201() -> None:
    with respx.mock() as router:
        sbx = await _sandbox(router)
        route = router.post(f"{API}/sandboxes/{SBX}/snapshot").mock(
            return_value=httpx.Response(201, json=_snap())
        )
        snap = await sbx.snapshot(name="before-upgrade")
        assert isinstance(snap, AsyncSnapshot)
        assert snap.status == SnapshotStatus.READY
        body = json.loads(route.calls.last.request.content)
        assert body["kind"] == "mem+fs"
        assert body["name"] == "before-upgrade"
        uuid.UUID(body["idempotency_key"])


@pytest.mark.asyncio
async def test_take_snapshot_202_polled_until_ready() -> None:
    with respx.mock() as router:
        sbx = await _sandbox(router)
        router.post(f"{API}/sandboxes/{SBX}/snapshot").mock(
            return_value=httpx.Response(202, json=_snap("creating"))
        )
        router.get(f"{API}/snapshots/{SNAP}").mock(
            side_effect=[
                httpx.Response(200, json=_snap("creating")),
                httpx.Response(200, json=_snap("ready")),
            ]
        )
        snap = await sbx.snapshot(poll_interval_s=0)
        assert snap.status == SnapshotStatus.READY


@pytest.mark.asyncio
async def test_failed_while_waiting_raises() -> None:
    with respx.mock() as router:
        sbx = await _sandbox(router)
        router.post(f"{API}/sandboxes/{SBX}/snapshot").mock(
            return_value=httpx.Response(202, json=_snap("creating"))
        )
        router.get(f"{API}/snapshots/{SNAP}").mock(
            return_value=httpx.Response(200, json=_snap("failed"))
        )
        with pytest.raises(SandboxError, match="failed"):
            await sbx.snapshot(poll_interval_s=0)


@pytest.mark.asyncio
async def test_ready_by_the_deadline_is_seen() -> None:
    # Less than one interval left: the wait still checks at the deadline.
    with respx.mock() as router:
        sbx = await _sandbox(router)
        router.post(f"{API}/sandboxes/{SBX}/snapshot").mock(
            return_value=httpx.Response(202, json=_snap("creating"))
        )
        route = router.get(f"{API}/snapshots/{SNAP}").mock(
            return_value=httpx.Response(200, json=_snap("ready"))
        )
        snap = await sbx.snapshot(timeout=0.05, poll_interval_s=2)
        assert snap.status == SnapshotStatus.READY
        assert route.call_count == 1


@pytest.mark.asyncio
async def test_list_get_rename_delete() -> None:
    with respx.mock() as router:
        sbx = await _sandbox(router)
        listed = router.get(url__startswith=f"{API}/sandboxes/{SBX}/snapshots").mock(
            return_value=httpx.Response(200, json=[_snap()])
        )
        router.get(f"{API}/snapshots/{SNAP}").mock(
            return_value=httpx.Response(200, json=_snap())
        )
        router.patch(f"{API}/snapshots/{SNAP}").mock(
            return_value=httpx.Response(200, json=_snap(name="after"))
        )
        router.delete(f"{API}/snapshots/{SNAP}").mock(
            side_effect=[
                httpx.Response(202),
                httpx.Response(404, json={"error": {"message": "gone"}}),
            ]
        )
        assert len(await sbx.snapshots(limit=5, offset=0)) == 1
        params = listed.calls.last.request.url.params
        assert (params["limit"], params["offset"]) == ("5", "0")
        snap = await AsyncSnapshot.get(SNAP)
        assert (await snap.rename("after")).name == "after"
        await snap.delete()
        await AsyncSnapshot.delete_by_id(SNAP)


@pytest.mark.asyncio
async def test_create_from_snapshot_instance() -> None:
    with respx.mock() as router:
        router.get(f"{API}/snapshots/{SNAP}").mock(
            return_value=httpx.Response(200, json=_snap())
        )
        route = router.post(f"{API}/sandboxes").mock(
            return_value=httpx.Response(201, json=_sandbox_raw(source_snapshot_id=SNAP))
        )
        await AsyncSandbox.create(
            name="fork", from_snapshot=await AsyncSnapshot.get(SNAP)
        )
        assert json.loads(route.calls.last.request.content)["from_snapshot"] == SNAP
