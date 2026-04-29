"""Tests for Commands.run — sync & streaming."""

from __future__ import annotations

import httpx
import pytest
import respx
from superserve.commands import Commands
from superserve.errors import SandboxError


def _make_commands() -> Commands:
    return Commands(
        base_url="https://api.example.com",
        sandbox_id="sbx-1",
        api_key="ss_live_key",
    )


class TestCommandsRun:
    def test_sync_returns_command_result(self) -> None:
        with respx.mock() as router:
            router.post("https://api.example.com/sandboxes/sbx-1/exec").mock(
                return_value=httpx.Response(
                    200,
                    json={"stdout": "hi\n", "stderr": "", "exit_code": 0},
                )
            )
            result = _make_commands().run("echo hi")
            assert result.stdout == "hi\n"
            assert result.stderr == ""
            assert result.exit_code == 0

    def test_sync_with_env_and_cwd(self) -> None:
        with respx.mock() as router:
            route = router.post("https://api.example.com/sandboxes/sbx-1/exec").mock(
                return_value=httpx.Response(
                    200,
                    json={"stdout": "ok", "stderr": "", "exit_code": 0},
                )
            )
            result = _make_commands().run(
                "ls", cwd="/tmp", env={"FOO": "bar"}, timeout_seconds=10
            )
            assert result.stdout == "ok"
            # verify body was sent
            request_body = route.calls.last.request.content
            assert b"/tmp" in request_body
            assert b"FOO" in request_body

    def test_nonzero_exit_code(self) -> None:
        with respx.mock() as router:
            router.post("https://api.example.com/sandboxes/sbx-1/exec").mock(
                return_value=httpx.Response(
                    200,
                    json={"stdout": "", "stderr": "boom", "exit_code": 1},
                )
            )
            result = _make_commands().run("false")
            assert result.exit_code == 1
            assert result.stderr == "boom"


class TestCommandsStreaming:
    def test_streaming_calls_callbacks(self) -> None:
        sse_body = (
            'data: {"stdout": "hello "}\n\n'
            'data: {"stdout": "world\\n"}\n\n'
            'data: {"stderr": "warn\\n"}\n\n'
            'data: {"finished": true, "exit_code": 0}\n\n'
        )
        stdout_chunks: list[str] = []
        stderr_chunks: list[str] = []

        with respx.mock() as router:
            router.post("https://api.example.com/sandboxes/sbx-1/exec/stream").mock(
                return_value=httpx.Response(
                    200,
                    content=sse_body.encode(),
                    headers={"Content-Type": "text/event-stream"},
                )
            )
            result = _make_commands().run(
                "echo hello world",
                on_stdout=stdout_chunks.append,
                on_stderr=stderr_chunks.append,
            )

        assert stdout_chunks == ["hello ", "world\n"]
        assert stderr_chunks == ["warn\n"]
        assert result.stdout == "hello world\n"
        assert result.stderr == "warn\n"
        assert result.exit_code == 0

    def test_streaming_raises_if_no_finished_event(self) -> None:
        sse_body = 'data: {"stdout": "partial"}\n\n'

        with respx.mock() as router:
            router.post("https://api.example.com/sandboxes/sbx-1/exec/stream").mock(
                return_value=httpx.Response(
                    200,
                    content=sse_body.encode(),
                    headers={"Content-Type": "text/event-stream"},
                )
            )
            with pytest.raises(SandboxError, match="finished"):
                _make_commands().run(
                    "echo partial",
                    on_stdout=lambda _c: None,
                )

    def test_streaming_with_nonzero_exit_code(self) -> None:
        sse_body = (
            'data: {"stderr": "err\\n"}\n\n'
            'data: {"finished": true, "exit_code": 42}\n\n'
        )

        with respx.mock() as router:
            router.post("https://api.example.com/sandboxes/sbx-1/exec/stream").mock(
                return_value=httpx.Response(
                    200,
                    content=sse_body.encode(),
                    headers={"Content-Type": "text/event-stream"},
                )
            )
            result = _make_commands().run("fail", on_stderr=lambda _c: None)

        assert result.exit_code == 42
        assert result.stderr == "err\n"
