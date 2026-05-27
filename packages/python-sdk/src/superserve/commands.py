"""``sandbox.commands`` - run shell commands inside a sandbox.

Hits the per-sandbox data plane with the access token. On 401 the SDK
auto-refreshes via ``POST /activate`` and retries once.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from ._config import data_plane_url
from ._http import api_request, async_api_request, async_stream_sse, stream_sse
from .errors import AuthenticationError, SandboxError
from .types import CommandResult


@dataclass(frozen=True)
class CommandsDeps:
    """Internal deps from Sandbox. ``refresh_activate`` is invoked on 401."""

    sandbox_id: str
    sandbox_host: str
    get_access_token: Callable[[], str]
    refresh_activate: Callable[[], str]


@dataclass(frozen=True)
class AsyncCommandsDeps:
    """Async variant of CommandsDeps."""

    sandbox_id: str
    sandbox_host: str
    get_access_token: Callable[[], str]
    refresh_activate: Callable[[], Awaitable[str]]


class Commands:
    """Sync command execution. Access as ``sandbox.commands``."""

    def __init__(
        self,
        deps: CommandsDeps,
        client: httpx.Client | None = None,
    ) -> None:
        self._deps = deps
        self._client = client
        self._data_plane_base_url = data_plane_url(
            deps.sandbox_id, deps.sandbox_host
        )

    def run(
        self,
        command: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout_seconds: int | None = None,
        on_stdout: Callable[[str], None] | None = None,
        on_stderr: Callable[[str], None] | None = None,
    ) -> CommandResult:
        """Execute a command inside the sandbox.

        Paused sandboxes are transparently resumed before execution.
        """
        body: dict[str, Any] = {"command": command}
        if cwd is not None:
            body["working_dir"] = cwd
        if env is not None:
            body["env"] = env
        if timeout_seconds is not None:
            body["timeout_s"] = timeout_seconds

        is_streaming = on_stdout is not None or on_stderr is not None

        if is_streaming:
            return self._run_streaming(
                body, on_stdout, on_stderr, timeout_seconds
            )
        return self._run_sync(body, timeout_seconds)

    def _run_sync(
        self,
        body: dict[str, Any],
        timeout_seconds: int | None,
    ) -> CommandResult:
        def send(token: str) -> dict[str, Any]:
            return api_request(
                "POST",
                f"{self._data_plane_base_url}/exec",
                headers={"X-Access-Token": token},
                json_body=body,
                timeout=float(timeout_seconds) + 5.0
                if timeout_seconds is not None
                else 30.0,
                client=self._client,
            )

        raw = self._with_token_retry(send)
        return CommandResult(
            stdout=raw.get("stdout", ""),
            stderr=raw.get("stderr", ""),
            exit_code=raw.get("exit_code", 0),
        )

    def _run_streaming(
        self,
        body: dict[str, Any],
        on_stdout: Callable[[str], None] | None,
        on_stderr: Callable[[str], None] | None,
        timeout_seconds: int | None,
    ) -> CommandResult:
        def send(token: str) -> CommandResult:
            return self._consume_stream(
                f"{self._data_plane_base_url}/exec/stream",
                {"X-Access-Token": token},
                body,
                on_stdout,
                on_stderr,
                timeout_seconds,
            )

        return self._with_token_retry(send)

    # Safe for streaming: 401 is returned in the HTTP status code before
    # any SSE data is written, so the retry can't double-emit callbacks.
    def _with_token_retry(
        self, send: Callable[[str], Any]
    ) -> Any:
        try:
            return send(self._deps.get_access_token())
        except AuthenticationError:
            fresh = self._deps.refresh_activate()
            return send(fresh)

    def _consume_stream(
        self,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        on_stdout: Callable[[str], None] | None,
        on_stderr: Callable[[str], None] | None,
        timeout_seconds: int | None,
    ) -> CommandResult:
        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        exit_code = 0
        saw_finished = False

        def handle_event(event: dict[str, Any]) -> None:
            nonlocal exit_code, saw_finished
            if event.get("stdout"):
                stdout_parts.append(event["stdout"])
                if on_stdout:
                    on_stdout(event["stdout"])
            if event.get("stderr"):
                stderr_parts.append(event["stderr"])
                if on_stderr:
                    on_stderr(event["stderr"])
            if event.get("finished"):
                saw_finished = True
                exit_code = event.get("exit_code", 0)
                if event.get("error"):
                    stderr_parts.append(event["error"])

        stream_sse(
            url,
            headers=headers,
            json_body=body,
            timeout=float(timeout_seconds) + 5.0
            if timeout_seconds is not None
            else 300.0,
            on_event=handle_event,
            client=self._client,
        )

        if not saw_finished:
            raise SandboxError(
                "Command stream ended without a finished event "
                "(possible network disconnect)"
            )

        return CommandResult(
            stdout="".join(stdout_parts),
            stderr="".join(stderr_parts),
            exit_code=exit_code,
        )


class AsyncCommands:
    """Async command execution. Access as ``sandbox.commands``."""

    def __init__(
        self,
        deps: AsyncCommandsDeps,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._deps = deps
        self._client = client
        self._data_plane_base_url = data_plane_url(
            deps.sandbox_id, deps.sandbox_host
        )

    async def run(
        self,
        command: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout_seconds: int | None = None,
        on_stdout: Callable[[str], None] | None = None,
        on_stderr: Callable[[str], None] | None = None,
    ) -> CommandResult:
        """Async variant of Commands.run()."""
        body: dict[str, Any] = {"command": command}
        if cwd is not None:
            body["working_dir"] = cwd
        if env is not None:
            body["env"] = env
        if timeout_seconds is not None:
            body["timeout_s"] = timeout_seconds

        is_streaming = on_stdout is not None or on_stderr is not None

        if is_streaming:
            return await self._run_streaming(
                body, on_stdout, on_stderr, timeout_seconds
            )
        return await self._run_sync(body, timeout_seconds)

    async def _run_sync(
        self,
        body: dict[str, Any],
        timeout_seconds: int | None,
    ) -> CommandResult:
        async def send(token: str) -> dict[str, Any]:
            return await async_api_request(
                "POST",
                f"{self._data_plane_base_url}/exec",
                headers={"X-Access-Token": token},
                json_body=body,
                timeout=float(timeout_seconds) + 5.0
                if timeout_seconds is not None
                else 30.0,
                client=self._client,
            )

        raw = await self._with_token_retry(send)
        return CommandResult(
            stdout=raw.get("stdout", ""),
            stderr=raw.get("stderr", ""),
            exit_code=raw.get("exit_code", 0),
        )

    async def _run_streaming(
        self,
        body: dict[str, Any],
        on_stdout: Callable[[str], None] | None,
        on_stderr: Callable[[str], None] | None,
        timeout_seconds: int | None,
    ) -> CommandResult:
        async def send(token: str) -> CommandResult:
            return await self._consume_stream(
                f"{self._data_plane_base_url}/exec/stream",
                {"X-Access-Token": token},
                body,
                on_stdout,
                on_stderr,
                timeout_seconds,
            )

        return await self._with_token_retry(send)

    async def _with_token_retry(
        self, send: Callable[[str], Awaitable[Any]]
    ) -> Any:
        try:
            return await send(self._deps.get_access_token())
        except AuthenticationError:
            fresh = await self._deps.refresh_activate()
            return await send(fresh)

    async def _consume_stream(
        self,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        on_stdout: Callable[[str], None] | None,
        on_stderr: Callable[[str], None] | None,
        timeout_seconds: int | None,
    ) -> CommandResult:
        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        exit_code = 0
        saw_finished = False

        def handle_event(event: dict[str, Any]) -> None:
            nonlocal exit_code, saw_finished
            if event.get("stdout"):
                stdout_parts.append(event["stdout"])
                if on_stdout:
                    on_stdout(event["stdout"])
            if event.get("stderr"):
                stderr_parts.append(event["stderr"])
                if on_stderr:
                    on_stderr(event["stderr"])
            if event.get("finished"):
                saw_finished = True
                exit_code = event.get("exit_code", 0)
                if event.get("error"):
                    stderr_parts.append(event["error"])

        await async_stream_sse(
            url,
            headers=headers,
            json_body=body,
            timeout=float(timeout_seconds) + 5.0
            if timeout_seconds is not None
            else 300.0,
            on_event=handle_event,
            client=self._client,
        )

        if not saw_finished:
            raise SandboxError(
                "Command stream ended without a finished event "
                "(possible network disconnect)"
            )

        return CommandResult(
            stdout="".join(stdout_parts),
            stderr="".join(stderr_parts),
            exit_code=exit_code,
        )
