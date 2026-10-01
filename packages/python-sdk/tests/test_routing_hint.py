import base64
import json
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
import respx

from superserve import Sandbox, AsyncSandbox
from superserve._token_retry import with_token_retry, async_with_token_retry
from superserve.errors import SandboxError, ServerError, NotFoundError

INFO = dict(
    id="sbx-1",
    name="example",
    status="active",
    vcpu_count=2,
    memory_mib=512,
    access_token="auth",
    created_at="2026-01-01T00:00:00Z",
    metadata={},
)
OPTS = dict(api_key="ss_live_test", base_url="https://api.example.com")


def test_sync_lifecycle_current_hint_and_old_backend():
    with respx.mock:
        create = respx.post("https://api.example.com/sandboxes").mock(
            return_value=httpx.Response(200, json={**INFO, "routing_hint": "initial"})
        )
        resume = respx.post("https://api.example.com/sandboxes/sbx-1/resume").mock(
            return_value=httpx.Response(200, json={**INFO, "routing_hint": "fresh"})
        )
        command = respx.post(url__regex=r".*/exec$").mock(
            return_value=httpx.Response(200, json={"exit_code": 0})
        )
        files = respx.post(url__regex=r".*/files.*").mock(
            return_value=httpx.Response(200, json={})
        )
        sb = Sandbox.create(name="example", **OPTS)
        sb.commands.run("echo once")
        assert (
            command.calls.last.request.headers["X-Superserve-Routing-Hint"] == "initial"
        )
        sb.resume()
        sb.files.write("/tmp/test", "hello")
        assert files.calls.last.request.headers["X-Superserve-Routing-Hint"] == "fresh"
        resume.mock(return_value=httpx.Response(200, json=INFO))
        sb.resume()
        sb.commands.run("echo once")
        assert "X-Superserve-Routing-Hint" not in command.calls.last.request.headers
        assert create.call_count == 1
        sb._close_http_client()


@pytest.mark.parametrize(
    "status,code", [(404, "sandbox_route_stale"), (503, "sandbox_unavailable")]
)
async def test_async_stale_route_refreshes_before_retry(status, code):
    with respx.mock:
        activate = respx.post("https://api.example.com/sandboxes/sbx-1/activate").mock(
            side_effect=[
                httpx.Response(200, json={**INFO, "routing_hint": "old"}),
                httpx.Response(200, json={**INFO, "routing_hint": "fresh"}),
            ]
        )
        command = respx.post(url__regex=r".*/exec$").mock(
            side_effect=[
                httpx.Response(status, json={"error": {"code": code}}),
                httpx.Response(200, json={"exit_code": 0}),
            ]
        )
        sb = await AsyncSandbox.connect("sbx-1", **OPTS)
        await sb.commands.run("echo once")
        assert activate.call_count == 2
        assert [
            c.request.headers["X-Superserve-Routing-Hint"] for c in command.calls
        ] == ["old", "fresh"]
        await sb._close_http_client()


@pytest.mark.parametrize(
    "err",
    [
        SandboxError("lost"),
        ServerError("gateway", status_code=502),
        ServerError("ambiguous", status_code=503),
        NotFoundError("file missing"),
    ],
)
def test_no_ambiguous_replay(err):
    send = Mock(side_effect=err)
    refresh = Mock()
    with pytest.raises(type(err)):
        with_token_retry(lambda: "auth", refresh, send, lambda: "hint")
    assert send.call_count == 1
    refresh.assert_not_called()


async def test_async_no_ambiguous_replay_and_expiry_refresh():
    send = AsyncMock(side_effect=SandboxError("lost"))
    refresh = AsyncMock()
    with pytest.raises(SandboxError):
        await async_with_token_retry(lambda: "auth", refresh, send, lambda: "hint")
    refresh.assert_not_called()
    assert send.call_count == 1
    hint = (
        "v1."
        + base64.urlsafe_b64encode(json.dumps({"e": 1}).encode()).decode()
        + ".sig"
    )
    send = AsyncMock(return_value="done")
    refresh = AsyncMock(return_value="auth")
    assert (
        await async_with_token_retry(lambda: "auth", refresh, send, lambda: hint)
        == "done"
    )
    assert refresh.call_count == 1 and send.call_count == 1


async def test_expired_hint_is_refreshed_once_for_concurrent_commands():
    import asyncio

    expired = "v1." + base64.urlsafe_b64encode(b'{"e":1}').decode() + ".sig"
    with respx.mock:
        respx.post("https://api.example.com/sandboxes").mock(
            return_value=httpx.Response(200, json={**INFO, "routing_hint": expired})
        )
        entered = asyncio.Event()

        async def activate(_):
            entered.set()
            await asyncio.sleep(0.02)
            return httpx.Response(200, json={**INFO, "routing_hint": "fresh"})

        activation = respx.post(
            "https://api.example.com/sandboxes/sbx-1/activate"
        ).mock(side_effect=activate)
        commands = respx.post(url__regex=r".*/exec$").mock(
            return_value=httpx.Response(200, json={"exit_code": 0})
        )
        sb = await AsyncSandbox.create(name="example", **OPTS)
        await asyncio.gather(*(sb.commands.run("echo once") for _ in range(100)))
        assert (
            entered.is_set()
            and activation.call_count == 1
            and commands.call_count == 100
        )
        assert all(
            c.request.headers["X-Superserve-Routing-Hint"] == "fresh"
            for c in commands.calls
        )
        await sb._close_http_client()


async def test_failed_later_resume_does_not_discard_earlier_success():
    import asyncio

    with respx.mock:
        respx.post("https://api.example.com/sandboxes").mock(
            return_value=httpx.Response(200, json={**INFO, "routing_hint": "old"})
        )
        entered, release = asyncio.Event(), asyncio.Event()
        calls = 0

        async def resume(_):
            nonlocal calls
            calls += 1
            if calls == 1:
                entered.set()
                await release.wait()
                return httpx.Response(200, json={**INFO, "routing_hint": "fresh"})
            return httpx.Response(400, json={"error": {"message": "failed"}})

        respx.post("https://api.example.com/sandboxes/sbx-1/resume").mock(
            side_effect=resume
        )
        sb = await AsyncSandbox.create(name="example", **OPTS)
        first = asyncio.create_task(sb.resume())
        await entered.wait()
        with pytest.raises(SandboxError):
            await sb.resume()
        release.set()
        await first
        assert sb._routing_hint == "fresh"
        await sb._close_http_client()


def test_inflight_retry_uses_dispatched_hint_even_when_refresh_clears_it():
    hint = ["signed"]

    def send(_):
        hint[0] = None
        raise ServerError("ambiguous", status_code=503)

    sending = Mock(side_effect=send)
    refresh = Mock()
    with pytest.raises(ServerError):
        with_token_retry(lambda: "auth", refresh, sending, lambda: hint[0])
    assert sending.call_count == 1
    refresh.assert_not_called()


async def test_async_files_and_stream_use_refreshed_hint():
    with respx.mock:
        respx.post("https://api.example.com/sandboxes").mock(
            return_value=httpx.Response(200, json={**INFO, "routing_hint": "old"})
        )
        respx.post("https://api.example.com/sandboxes/sbx-1/activate").mock(
            return_value=httpx.Response(200, json={**INFO, "routing_hint": "fresh"})
        )
        stream = respx.post(url__regex=r".*/exec/stream$").mock(
            side_effect=[
                httpx.Response(404, json={"error": {"code": "sandbox_route_stale"}}),
                httpx.Response(
                    200,
                    content='data: {"stdout":"ok","finished":true,"exit_code":0}\n\n',
                    headers={"Content-Type": "text/event-stream"},
                ),
            ]
        )
        write = respx.post(url__regex=r".*/files.*").mock(
            return_value=httpx.Response(200, json={})
        )
        read = respx.get(url__regex=r".*/files.*").mock(
            return_value=httpx.Response(200, content=b"hello")
        )
        sb = await AsyncSandbox.create(name="example", **OPTS)
        output = []
        await sb.commands.run("echo once", on_stdout=output.append)
        assert output == ["ok"]
        assert [
            c.request.headers["X-Superserve-Routing-Hint"] for c in stream.calls
        ] == ["old", "fresh"]
        await sb.files.write("/tmp/test", "hello")
        assert await sb.files.read("/tmp/test") == b"hello"
        assert write.calls.last.request.headers["X-Superserve-Routing-Hint"] == "fresh"
        assert read.calls.last.request.headers["X-Superserve-Routing-Hint"] == "fresh"
        await sb._close_http_client()


@pytest.mark.parametrize("repeat_failure", [False, True])
def test_sync_hinted_unavailable_refreshes_and_retries_only_once(repeat_failure):
    unavailable = ServerError("paused", code="sandbox_unavailable", status_code=503)
    send = Mock(side_effect=[unavailable, unavailable if repeat_failure else "done"])
    refresh = Mock(return_value="fresh-auth")
    if repeat_failure:
        with pytest.raises(ServerError):
            with_token_retry(lambda: "old-auth", refresh, send, lambda: "hint")
    else:
        assert (
            with_token_retry(lambda: "old-auth", refresh, send, lambda: "hint")
            == "done"
        )
    assert send.call_count == 2
    assert refresh.call_count == 1
    assert send.call_args.args == ("fresh-auth",)


@pytest.mark.parametrize(
    "body,safe",
    [
        ("sandbox is paused\n", True),
        ("sandbox is stopped\n", True),
        ("sandbox is paused", False),
        ("sandbox is paused\nextra", False),
        ("upstream unavailable\n", False),
    ],
)
async def test_old_proxy_paused_response_is_safe_but_lookalikes_are_not(body, safe):
    with respx.mock:
        activate = respx.post("https://api.example.com/sandboxes/sbx-1/activate").mock(
            return_value=httpx.Response(200, json={**INFO, "routing_hint": "hint"})
        )
        command = respx.post(url__regex=r".*/exec$").mock(
            side_effect=[
                httpx.Response(
                    503,
                    text=body,
                    headers={
                        "Content-Type": "text/plain; charset=utf-8",
                        "X-Content-Type-Options": "nosniff",
                    },
                ),
                httpx.Response(200, json={"stdout": "ok", "exit_code": 0}),
            ]
        )
        sb = await AsyncSandbox.connect("sbx-1", **OPTS)
        if safe:
            assert (await sb.commands.run("echo once")).stdout == "ok"
        else:
            with pytest.raises(ServerError):
                await sb.commands.run("echo once")
        assert activate.call_count == (2 if safe else 1)
        assert command.call_count == (2 if safe else 1)
        await sb._close_http_client()
