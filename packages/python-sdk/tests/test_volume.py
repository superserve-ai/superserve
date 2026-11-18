from __future__ import annotations

import asyncio
import inspect
import json
from datetime import datetime, timezone
from typing import Any

import httpx
import pytest
import respx
from superserve import (
    AsyncSandbox,
    AsyncVolume,
    ConflictError,
    Sandbox,
    SandboxError,
    ValidationError,
    Volume,
)
from superserve.volume import _same_volume_sandbox

API = "https://api.example.test"
VOLUME = {
    "id": "c6cb5b6b-c4d6-4269-8b78-b5533bcfa008",
    "name": "data",
    "capacity_bytes": 1073741824,
    "used_bytes": 42,
    "region": "example",
    "status": "ready",
    "generation": 1,
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-02T00:00:00Z",
}
GUEST = {
    "id": "05609d7c-c59a-4f96-b7e5-0892a4260588",
    "name": "example",
    "status": "active",
    "access_token": "example-token",
    "created_at": VOLUME["created_at"],
}
ATTACHMENT = {
    "id": "bdb16649-1ee4-4857-beb3-829921b6ea6d",
    "volume_id": VOLUME["id"],
    "sandbox_id": GUEST["id"],
    "mount_path": "/mnt/data",
    "read_only": False,
    "status": "mounted",
    "generation": 1,
    "lease_expires_at": "2026-01-03T00:00:00Z",
    "created_at": VOLUME["created_at"],
    "updated_at": VOLUME["updated_at"],
}


@pytest.fixture(autouse=True)
def connection(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "example-key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)


async def call(method: Any, *args: Any, **kwargs: Any) -> Any:
    value = method(*args, **kwargs)
    return await value if inspect.isawaitable(value) else value


@pytest.mark.parametrize("resource", [Sandbox, AsyncSandbox])
@pytest.mark.parametrize("mode", ["too many", "duplicate paths"])
async def test_rejects_invalid_mount_batch_before_guest_creation(
    resource: Any, mode: str
) -> None:
    mounts = (
        [{"volume": "data", "mount_path": f"/mnt/data-{i}"} for i in range(129)]
        if mode == "too many"
        else [
            {
                "volume": "data",
                "mount_path": "/mnt/data",
                "idempotency_key": "repeated",
            },
            {
                "volume": "data",
                "mount_path": "/mnt/data",
                "idempotency_key": "repeated",
            },
        ]
    )
    with respx.mock() as router:
        with pytest.raises(ValidationError):
            await call(resource.create, name="example", volumes=mounts)
        assert not router.calls


@pytest.mark.parametrize("guest_type", [Sandbox, AsyncSandbox])
@pytest.mark.parametrize(
    "attachment_id", [GUEST["id"], GUEST["id"].upper(), "sb-usw-" + GUEST["id"]]
)
async def test_prefixed_create_with_volume_never_cleans_up_successful_guest(
    guest_type: Any, attachment_id: str
) -> None:
    tagged = "sb-usw-" + GUEST["id"]
    with respx.mock() as router:
        router.post(f"{API}/sandboxes").respond(201, json={**GUEST, "id": tagged})
        router.get(f"{API}/volumes/data").respond(200, json=VOLUME)
        attach = router.post(f"{API}/sandboxes/{tagged}/volumes").respond(
            201, json={**ATTACHMENT, "sandbox_id": attachment_id}
        )
        router.get(f"{API}/volume-attachments/{ATTACHMENT['id']}").respond(
            200, json={**ATTACHMENT, "sandbox_id": attachment_id}
        )
        detach = router.delete(f"{API}/volume-attachments/{ATTACHMENT['id']}").respond(
            204
        )
        guest = await call(
            guest_type.create,
            name="example",
            volumes=[{"volume": "data", "mount_path": "/mnt/data"}],
        )
        try:
            assert guest.id == tagged and attach.call_count == 1
            assert not any(r.request.method == "DELETE" for r in router.calls)
            await call(guest.detach_volume, ATTACHMENT["id"])
            assert detach.call_count == 1
            assert [
                r.request.url.path for r in router.calls if r.request.method == "DELETE"
            ] == [f"/volume-attachments/{ATTACHMENT['id']}"]
        finally:
            await call(guest._close_http_client)


@pytest.mark.parametrize("resource", [Volume, AsyncVolume])
async def test_raw_uuid_input_accepts_prefixed_native_response(resource: Any) -> None:
    with respx.mock() as router:
        router.get(f"{API}/volumes/data").respond(200, json=VOLUME)
        router.post(f"{API}/sandboxes/{GUEST['id'].upper()}/volumes").respond(
            201, json={**ATTACHMENT, "sandbox_id": "sb-usw-" + GUEST["id"]}
        )
        handle = await call(resource.connect, "data")
        result = await call(handle.attach, GUEST["id"].upper(), mount_path="/mnt/data")
        assert result.sandbox_id == "sb-usw-" + GUEST["id"]


@pytest.mark.parametrize("guest_type", [Sandbox, AsyncSandbox])
@pytest.mark.parametrize(
    "wrong_id",
    [
        "sb-usw-811f0680-f527-445c-b606-9ab9b93db454",
        "sb-use-" + GUEST["id"],
        "opaque-usw-" + GUEST["id"],
        "sb-us-west-" + GUEST["id"],
    ],
)
async def test_volume_operations_reject_different_uuid_region_or_opaque_suffix(
    guest_type: Any, wrong_id: str
) -> None:
    tagged = "sb-usw-" + GUEST["id"]
    with respx.mock() as router:
        router.post(f"{API}/sandboxes").respond(201, json={**GUEST, "id": tagged})
        router.get(f"{API}/volumes/data").respond(200, json=VOLUME)
        router.post(f"{API}/sandboxes/{tagged}/volumes").respond(
            201, json={**ATTACHMENT, "sandbox_id": wrong_id}
        )
        router.get(f"{API}/volume-attachments/{ATTACHMENT['id']}").respond(
            200, json={**ATTACHMENT, "sandbox_id": wrong_id}
        )
        guest = await call(guest_type.create, name="example")
        try:
            with pytest.raises(Exception, match="did not confirm"):
                await call(guest.attach_volume, "data", mount_path="/mnt/data")
            with pytest.raises(ValidationError):
                await call(guest.detach_volume, ATTACHMENT["id"])
            assert not any(r.request.method == "DELETE" for r in router.calls)
        finally:
            await call(guest._close_http_client)


@pytest.mark.parametrize(
    "a,b,expected",
    [
        ("opaque-id", "opaque-id", True),
        ("opaque-id", "different-opaque-id", False),
        ("prefix-" + GUEST["id"], GUEST["id"], False),
        (GUEST["id"] + "\n", GUEST["id"], False),
        ("sb-usw-" + GUEST["id"], "sb-use-" + GUEST["id"], False),
    ],
)
def test_volume_id_matching_preserves_opaque_and_explicit_region_boundaries(
    a: str, b: str, expected: bool
) -> None:
    assert _same_volume_sandbox(a, b) is expected


@pytest.mark.parametrize("resource", [Volume, AsyncVolume])
async def test_native_volume_contract_and_dates(resource: Any) -> None:
    with respx.mock() as router:
        create = router.post(f"{API}/volumes").respond(201, json=VOLUME)
        lookup = router.get(f"{API}/volumes/{VOLUME['id']}").respond(200, json=VOLUME)
        router.get(f"{API}/volumes", params={"limit": 2}).respond(200, json=[VOLUME])
        attach = router.post(f"{API}/sandboxes/{GUEST['id']}/volumes").respond(
            201, json=ATTACHMENT
        )
        router.get(f"{API}/volumes/{VOLUME['id']}/attachments").respond(
            200, json=[ATTACHMENT]
        )
        router.get(f"{API}/volume-attachments/{ATTACHMENT['id']}").respond(
            200, json=ATTACHMENT
        )
        detach = router.delete(f"{API}/volume-attachments/{ATTACHMENT['id']}").respond(
            204
        )
        handle = await call(
            resource.create,
            name="data",
            capacity_bytes=1073741824,
            idempotency_key="stable-create",
        )
        assert json.loads(create.calls.last.request.content) == {
            "name": "data",
            "capacity_bytes": 1073741824,
            "idempotency_key": "stable-create",
        }
        assert 179.0 < create.calls.last.request.extensions["timeout"]["read"] <= 180.0
        assert handle.created_at == datetime(2026, 1, 1, tzinfo=timezone.utc)
        assert (await call(handle.get_info)).used_bytes == 42
        assert lookup.call_count == 1
        assert (await call(resource.list, limit=2))[0].name == "data"
        mounted = await call(
            handle.attach,
            GUEST["id"],
            mount_path="/mnt/data",
            idempotency_key="stable-attach",
        )
        assert mounted.lease_expires_at == datetime(2026, 1, 3, tzinfo=timezone.utc)
        assert json.loads(attach.calls.last.request.content) == {
            "volume_id": VOLUME["id"],
            "mount_path": "/mnt/data",
            "idempotency_key": "stable-attach",
        }
        assert 179.0 < attach.calls.last.request.extensions["timeout"]["read"] <= 180.0
        assert len(await call(handle.list_attachments)) == 1
        await call(handle.detach, ATTACHMENT["id"])
        assert detach.call_count == 1
        await call(resource.create, name="default")
        body = json.loads(create.calls.last.request.content)
        assert "capacity_bytes" not in body and len(body["idempotency_key"]) == 36


@pytest.mark.parametrize("resource", [Volume, AsyncVolume])
async def test_volume_names_are_single_encoded_path_segments(resource: Any) -> None:
    with respx.mock() as router:
        lookup = router.get(f"{API}/volumes/name%2Fwith%3F%23").respond(
            200, json=VOLUME
        )
        delete = router.delete(f"{API}/volumes/name%2Fwith%3F%23").respond(204)
        await call(resource.connect, "name/with?#")
        await call(resource.delete_by_id, "name/with?#")
        assert lookup.calls.last.request.url.raw_path == b"/volumes/name%2Fwith%3F%23"
        assert delete.call_count == 1


@pytest.mark.parametrize("guest_type", [Sandbox, AsyncSandbox])
async def test_new_sandbox_partial_mount_failure_deletes_only_guest(
    guest_type: Any,
) -> None:
    with respx.mock() as router:
        create = router.post(f"{API}/sandboxes").respond(201, json=GUEST)
        router.get(f"{API}/volumes/data").respond(200, json=VOLUME)
        router.get(f"{API}/volumes/other").respond(200, json=VOLUME)
        mounts = router.post(f"{API}/sandboxes/{GUEST['id']}/volumes").mock(
            side_effect=[
                httpx.Response(201, json=ATTACHMENT),
                httpx.Response(
                    409, json={"error": {"code": "volume_in_use", "message": "busy"}}
                ),
            ]
        )
        delete = router.delete(f"{API}/sandboxes/{GUEST['id']}").respond(204)
        with pytest.raises(ConflictError) as error:
            await call(
                guest_type.create,
                name="example",
                volumes=[
                    {"volume": "data", "mount_path": "/mnt/data"},
                    {"volume": "other", "mount_path": "/mnt/other"},
                ],
            )
        assert error.value.code == "volume_in_use"
        assert json.loads(create.calls.last.request.content) == {"name": "example"}
        assert mounts.call_count == 2 and delete.call_count == 1
        assert [r.request.method for r in router.calls].count("DELETE") == 1
        assert not any(
            r.request.url.path == "/volumes" and r.request.method == "POST"
            for r in router.calls
        )


@pytest.mark.parametrize(
    "guest_type,resource", [(Sandbox, Volume), (AsyncSandbox, AsyncVolume)]
)
async def test_no_volume_requests_and_cross_connection_guard(
    guest_type: Any, resource: Any
) -> None:
    with respx.mock() as router:
        router.post(f"{API}/sandboxes").respond(201, json=GUEST)
        guest = await call(guest_type.create, name="example")
        try:
            assert len(router.calls) == 1
            router.get("https://other.example.test/volumes/data").respond(
                200, json=VOLUME
            )
            foreign = await call(
                resource.connect, "data", base_url="https://other.example.test"
            )
            router.get(f"{API}/volumes/data").respond(200, json=VOLUME)
            other_key = await call(
                resource.connect, "data", api_key="other-example-key"
            )
            before = len(router.calls)
            with pytest.raises(ValidationError):
                await call(foreign.attach, guest, mount_path="/mnt/data")
            with pytest.raises(ValidationError):
                await call(guest.attach_volume, other_key, mount_path="/mnt/data")
            with pytest.raises(ValidationError):
                await call(
                    guest_type.create,
                    name="new",
                    volumes=[{"volume": foreign, "mount_path": "/mnt/data"}],
                )
            assert len(router.calls) == before
        finally:
            await call(guest._close_http_client)


@pytest.mark.parametrize("resource", [Volume, AsyncVolume])
async def test_terminal_conflict_and_uncertain_create_are_not_retried(
    resource: Any,
) -> None:
    with respx.mock() as router:
        conflict = {
            "error": {"code": "volume_quota_exceeded", "message": "quota reached"}
        }
        create = router.post(f"{API}/volumes").respond(409, json=conflict)
        delete = router.delete(f"{API}/volumes/data").respond(409, json=conflict)
        with pytest.raises(ConflictError):
            await call(resource.create, name="data")
        with pytest.raises(ConflictError):
            await call(resource.delete_by_id, "data")
        assert create.call_count == delete.call_count == 1
        create.mock(side_effect=httpx.ReadError("connection interrupted"))
        with pytest.raises(Exception):
            await call(resource.create, name="data", idempotency_key="caller-stable")
        assert create.call_count == 2


async def test_async_cancellation_cleans_only_new_sandbox() -> None:
    entered = asyncio.Event()

    async def blocked(_request: httpx.Request) -> httpx.Response:
        entered.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    with respx.mock(assert_all_called=False) as router:
        router.post(f"{API}/sandboxes").respond(201, json=GUEST)
        router.get(f"{API}/volumes/data").respond(200, json=VOLUME)
        router.post(f"{API}/sandboxes/{GUEST['id']}/volumes").mock(side_effect=blocked)
        cleanup = router.delete(f"{API}/sandboxes/{GUEST['id']}").respond(204)
        task = asyncio.create_task(
            AsyncSandbox.create(
                name="example", volumes=[{"volume": "data", "mount_path": "/mnt/data"}]
            )
        )
        await asyncio.wait_for(entered.wait(), 5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cleanup.call_count == 1


@pytest.mark.parametrize("cancel_mount", [False, True])
@pytest.mark.parametrize("cleanup_status", [204, 500])
async def test_repeated_cancellation_drains_native_cleanup_before_closing_client(
    monkeypatch: pytest.MonkeyPatch, cancel_mount: bool, cleanup_status: int
) -> None:
    mount_entered = asyncio.Event()
    cleanup_entered = asyncio.Event()
    finish_cleanup = asyncio.Event()
    cleanup_finished = asyncio.Event()
    guests: list[AsyncSandbox] = []
    original_attach = AsyncSandbox.attach_volume

    async def capture_guest(self: AsyncSandbox, *args: Any, **kwargs: Any) -> Any:
        guests.append(self)
        return await original_attach(self, *args, **kwargs)

    monkeypatch.setattr(AsyncSandbox, "attach_volume", capture_guest)

    async def mounting(_request: httpx.Request) -> httpx.Response:
        mount_entered.set()
        if cancel_mount:
            await asyncio.Event().wait()
        return httpx.Response(
            409, json={"error": {"code": "volume_in_use", "message": "busy"}}
        )

    async def deleting(_request: httpx.Request) -> httpx.Response:
        cleanup_entered.set()
        await finish_cleanup.wait()
        assert not guests[0]._http_client.is_closed
        cleanup_finished.set()
        return (
            httpx.Response(204)
            if cleanup_status == 204
            else httpx.Response(
                500, json={"error": {"code": "cleanup_rejected", "message": "failed"}}
            )
        )

    with respx.mock(assert_all_called=False) as router:
        router.post(f"{API}/sandboxes").respond(201, json=GUEST)
        router.get(f"{API}/volumes/data").respond(200, json=VOLUME)
        router.post(f"{API}/sandboxes/{GUEST['id']}/volumes").mock(side_effect=mounting)
        cleanup = router.delete(f"{API}/sandboxes/{GUEST['id']}").mock(
            side_effect=deleting
        )
        task = asyncio.create_task(
            AsyncSandbox.create(
                name="example", volumes=[{"volume": "data", "mount_path": "/mnt/data"}]
            )
        )
        try:
            await asyncio.wait_for(mount_entered.wait(), 5)
            if cancel_mount:
                task.cancel("cancel mount")
            await asyncio.wait_for(cleanup_entered.wait(), 5)
            for _ in range(3):
                task.cancel("cancel while cleanup is blocked")
                await asyncio.sleep(0)
                assert not task.done()
                assert not guests[0]._http_client.is_closed
                assert not cleanup_finished.is_set()
            finish_cleanup.set()
            if cleanup_status == 204:
                with pytest.raises(asyncio.CancelledError):
                    await asyncio.wait_for(task, 5)
            else:
                with pytest.raises(SandboxError) as error:
                    await asyncio.wait_for(task, 5)
                assert error.value.code == "volume_cleanup_failed"
                assert GUEST["id"] in str(error.value)
            assert cleanup_finished.is_set()
            assert guests[0]._http_client.is_closed
            assert cleanup.call_count == 1
        finally:
            finish_cleanup.set()
            if not task.done():
                try:
                    await asyncio.wait_for(task, 5)
                except (Exception, asyncio.CancelledError):
                    pass


async def test_cancellation_keeps_cleanup_client_alive_for_native_delete_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    retry_started = asyncio.Event()
    retry_entered = asyncio.Event()
    finish_cleanup = asyncio.Event()
    guests: list[AsyncSandbox] = []
    original_attach = AsyncSandbox.attach_volume

    async def capture_guest(self: AsyncSandbox, *args: Any, **kwargs: Any) -> Any:
        guests.append(self)
        return await original_attach(self, *args, **kwargs)

    monkeypatch.setattr(AsyncSandbox, "attach_volume", capture_guest)
    attempts = 0

    async def deleting(_request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            retry_started.set()
            return httpx.Response(503, json={"error": {"code": "unavailable"}})
        retry_entered.set()
        await finish_cleanup.wait()
        assert not guests[0]._http_client.is_closed
        return httpx.Response(204)

    with respx.mock() as router:
        router.post(f"{API}/sandboxes").respond(201, json=GUEST)
        router.get(f"{API}/volumes/data").respond(200, json=VOLUME)
        router.post(f"{API}/sandboxes/{GUEST['id']}/volumes").respond(
            409, json={"error": {"code": "volume_in_use", "message": "busy"}}
        )
        cleanup = router.delete(f"{API}/sandboxes/{GUEST['id']}").mock(
            side_effect=deleting
        )
        task = asyncio.create_task(
            AsyncSandbox.create(
                name="example", volumes=[{"volume": "data", "mount_path": "/mnt/data"}]
            )
        )
        try:
            await asyncio.wait_for(retry_started.wait(), 5)
            task.cancel("cancel pending cleanup retry")
            await asyncio.wait_for(retry_entered.wait(), 5)
            assert not task.done()
            assert not guests[0]._http_client.is_closed
            task.cancel("cancel the retry again")
            finish_cleanup.set()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, 5)
            assert cleanup.call_count == 2
            assert guests[0]._http_client.is_closed
        finally:
            finish_cleanup.set()
            if not task.done():
                try:
                    await asyncio.wait_for(task, 5)
                except (Exception, asyncio.CancelledError):
                    pass


@pytest.mark.parametrize("guest_type", [Sandbox, AsyncSandbox])
async def test_existing_sandbox_survives_incomplete_attachment(guest_type: Any) -> None:
    with respx.mock() as router:
        router.post(f"{API}/sandboxes").respond(201, json=GUEST)
        router.get(f"{API}/volumes/data").respond(200, json=VOLUME)
        attach = router.post(f"{API}/sandboxes/{GUEST['id']}/volumes").respond(
            201, json={**ATTACHMENT, "status": "mounting"}
        )
        guest = await call(guest_type.create, name="example")
        try:
            with pytest.raises(Exception, match="did not confirm"):
                await call(guest.attach_volume, "data", mount_path="/mnt/data")
            attach.respond(201, json={**ATTACHMENT, "read_only": True})
            with pytest.raises(Exception, match="did not confirm"):
                await call(guest.attach_volume, "data", mount_path="/mnt/data")
            assert not any(r.request.method == "DELETE" for r in router.calls)
        finally:
            await call(guest._close_http_client)
