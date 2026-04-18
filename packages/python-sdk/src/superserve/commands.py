"""Commands sub-module for executing shell commands inside a sandbox."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

import httpx

from ._http import api_request, async_api_request, async_stream_sse, stream_sse
from .errors import SandboxError
from .types import CommandResult


class Commands:
    """Sync command execution. Access as ``sandbox.commands``."""

    def __init__(
        self,
        base_url: str,
        sandbox_id: str,
        api_key: str,
        client: Optional[httpx.Client] = None,
    ) -> None:
        self._base_url = base_url
        self._sandbox_id = sandbox_id
        self._api_key = api_key
        self._client = client

    def run(
        self,
        command: str,
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        timeout_seconds: Optional[int] = None,
        on_stdout: Optional[Callable[[str], None]] = None,
        on_stderr: Optional[Callable[[str], None]] = None,
    ) -> CommandResult:
        """Execute a command inside the sandbox."""
        body: Dict[str, Any] = {"command": command}
        if cwd is not None:
            body["working_dir"] = cwd
        if env is not None:
            body["env"] = env
        if timeout_seconds is not None:
            body["timeout_s"] = timeout_seconds

        headers = {"X-API-Key": self._api_key}
        is_streaming = on_stdout is not None or on_stderr is not None

        if is_streaming:
            return self._run_streaming(body, headers, on_stdout, on_stderr, timeout_seconds)
        return self._run_sync(body, headers, timeout_seconds)

    def _run_sync(
        self,
        body: Dict[str, Any],
        headers: Dict[str, str],
        timeout_seconds: Optional[int],
    ) -> CommandResult:
        raw = api_request(
            "POST",
            f"{self._base_url}/sandboxes/{self._sandbox_id}/exec",
            headers=headers,
            json_body=body,
            timeout=float(timeout_seconds) + 5.0 if timeout_seconds is not None else 30.0,
            client=self._client,
        )
        return CommandResult(
            stdout=raw.get("stdout", ""),
            stderr=raw.get("stderr", ""),
            exit_code=raw.get("exit_code", 0),
        )

    def _run_streaming(
        self,
        body: Dict[str, Any],
        headers: Dict[str, str],
        on_stdout: Optional[Callable[[str], None]],
        on_stderr: Optional[Callable[[str], None]],
        timeout_seconds: Optional[int],
    ) -> CommandResult:
        stdout_parts: List[str] = []
        stderr_parts: List[str] = []
        exit_code = 0
        saw_finished = False

        def handle_event(event: Dict[str, Any]) -> None:
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
            f"{self._base_url}/sandboxes/{self._sandbox_id}/exec/stream",
            headers=headers,
            json_body=body,
            timeout=float(timeout_seconds) + 5.0 if timeout_seconds is not None else 300.0,
            on_event=handle_event,
            client=self._client,
        )

        if not saw_finished:
            raise SandboxError(
                "Command stream ended without a finished event (possible network disconnect)"
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
        base_url: str,
        sandbox_id: str,
        api_key: str,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self._base_url = base_url
        self._sandbox_id = sandbox_id
        self._api_key = api_key
        self._client = client

    async def run(
        self,
        command: str,
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        timeout_seconds: Optional[int] = None,
        on_stdout: Optional[Callable[[str], None]] = None,
        on_stderr: Optional[Callable[[str], None]] = None,
    ) -> CommandResult:
        """Async variant of Commands.run()."""
        body: Dict[str, Any] = {"command": command}
        if cwd is not None:
            body["working_dir"] = cwd
        if env is not None:
            body["env"] = env
        if timeout_seconds is not None:
            body["timeout_s"] = timeout_seconds

        headers = {"X-API-Key": self._api_key}
        is_streaming = on_stdout is not None or on_stderr is not None

        if is_streaming:
            return await self._run_streaming(body, headers, on_stdout, on_stderr, timeout_seconds)
        return await self._run_sync(body, headers, timeout_seconds)

    async def _run_sync(
        self,
        body: Dict[str, Any],
        headers: Dict[str, str],
        timeout_seconds: Optional[int],
    ) -> CommandResult:
        raw = await async_api_request(
            "POST",
            f"{self._base_url}/sandboxes/{self._sandbox_id}/exec",
            headers=headers,
            json_body=body,
            timeout=float(timeout_seconds) + 5.0 if timeout_seconds is not None else 30.0,
            client=self._client,
        )
        return CommandResult(
            stdout=raw.get("stdout", ""),
            stderr=raw.get("stderr", ""),
            exit_code=raw.get("exit_code", 0),
        )

    async def _run_streaming(
        self,
        body: Dict[str, Any],
        headers: Dict[str, str],
        on_stdout: Optional[Callable[[str], None]],
        on_stderr: Optional[Callable[[str], None]],
        timeout_seconds: Optional[int],
    ) -> CommandResult:
        stdout_parts: List[str] = []
        stderr_parts: List[str] = []
        exit_code = 0
        saw_finished = False

        def handle_event(event: Dict[str, Any]) -> None:
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
            f"{self._base_url}/sandboxes/{self._sandbox_id}/exec/stream",
            headers=headers,
            json_body=body,
            timeout=float(timeout_seconds) + 5.0 if timeout_seconds is not None else 300.0,
            on_event=handle_event,
            client=self._client,
        )

        if not saw_finished:
            raise SandboxError(
                "Command stream ended without a finished event (possible network disconnect)"
            )

        return CommandResult(
            stdout="".join(stdout_parts),
            stderr="".join(stderr_parts),
            exit_code=exit_code,
        )
