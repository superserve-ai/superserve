"""Full-duplex command sessions over the data-plane ``/exec/connect`` WebSocket.

Async-only: full-duplex WebSocket I/O doesn't belong in a blocking call, so
``spawn`` lives on the async sandbox. The wire is byte-exact — I/O rides binary
frames tagged with a one-byte channel (0 stdin, 1 stdout, 2 stderr); lifecycle
and control ride text JSON frames. Backs ``sandbox.commands.spawn(...)``.
"""

from __future__ import annotations

import asyncio
import codecs
import contextlib
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Union

from .errors import SandboxError
from .types import CommandResult

# Negotiated on upgrade alongside the ``token.<value>`` carrier subprotocol.
_EXEC_SUBPROTOCOL = "superserve.exec.v1"
_TOKEN_PREFIX = "token."

_CH_STDIN = 0
_CH_STDOUT = 1
_CH_STDERR = 2


def _retrieve_exception(fut: "asyncio.Future[Any]") -> None:
    # Touch the result so asyncio doesn't warn when it's never awaited.
    if not fut.cancelled():
        fut.exception()


@dataclass(frozen=True)
class AsyncSpawnDeps:
    """Connection inputs, supplied by AsyncCommands."""

    sandbox_id: str
    sandbox_host: str
    get_access_token: Callable[[], str]
    refresh_activate: Callable[[], Awaitable[str]]


async def spawn_command(
    deps: AsyncSpawnDeps,
    command: str,
    *,
    cwd: str | None = None,
    env: dict[str, str] | None = None,
    timeout_seconds: int | None = None,
    on_stdout: Callable[[str], None] | None = None,
    on_stderr: Callable[[str], None] | None = None,
) -> AsyncCommandSession:
    """Open an exec session: dial, send the start frame, return the handle."""
    try:
        import websockets
    except ModuleNotFoundError as exc:  # pragma: no cover
        raise SandboxError(
            "commands.spawn requires the 'websockets' package, which ships "
            "with superserve by default."
        ) from exc

    # Always the per-sandbox subdomain, not the shared-host routing that run/
    # files use: a browser can't set the sandbox-id header on a WS upgrade, and
    # each session is its own long-lived socket, so there's no pool to share.
    uri = f"wss://boxd-{deps.sandbox_id}.{deps.sandbox_host}/exec/connect"
    start: dict[str, Any] = {"command": command}
    if cwd is not None:
        start["working_dir"] = cwd
    if env is not None:
        start["env"] = env
    if timeout_seconds is not None:
        start["timeout_s"] = timeout_seconds

    ws = await _dial_with_resume(websockets, deps, uri)
    await ws.send(json.dumps(start))
    return AsyncCommandSession(ws, on_stdout, on_stderr)


async def _dial_with_resume(websockets: Any, deps: AsyncSpawnDeps, uri: str) -> Any:
    # A failed dial can mean a stale token or a paused sandbox; both are fixed
    # by activating (which resumes and rotates the token), so retry once.
    try:
        return await _dial(websockets, uri, deps.get_access_token())
    except Exception:
        token = await deps.refresh_activate()
        return await _dial(websockets, uri, token)


async def _dial(websockets: Any, uri: str, token: str) -> Any:
    return await websockets.connect(
        uri, subprotocols=[_EXEC_SUBPROTOCOL, _TOKEN_PREFIX + token]
    )


class AsyncStdin:
    """Write to and close a running process's stdin."""

    def __init__(self, ws: Any) -> None:
        self._ws = ws

    async def write(self, data: Union[str, bytes]) -> None:
        """Write to stdin. ``str`` is UTF-8 encoded; ``bytes`` is sent as-is."""
        raw = data.encode() if isinstance(data, str) else bytes(data)
        await self._ws.send(bytes([_CH_STDIN]) + raw)

    async def close(self) -> None:
        """Close stdin, signalling EOF."""
        await self._ws.send(json.dumps({"type": "stdin_close"}))


class AsyncCommandSession:
    """A live, full-duplex handle to a running command.

    Stream output via the ``on_stdout`` / ``on_stderr`` callbacks, write to
    ``stdin``, ``kill`` it, and ``await wait()`` for the exit result. Use as an
    ``async with`` block to kill and close on exit.
    """

    def __init__(
        self,
        ws: Any,
        on_stdout: Callable[[str], None] | None,
        on_stderr: Callable[[str], None] | None,
    ) -> None:
        self._ws = ws
        self._on_stdout = on_stdout
        self._on_stderr = on_stderr
        self.stdin = AsyncStdin(ws)
        # Incremental decoders carry partial multi-byte runes across frames;
        # errors="replace" keeps non-UTF-8 output from killing the session
        # (it becomes U+FFFD, matching the TypeScript TextDecoder).
        self._out_decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self._err_decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self._stdout: list[str] = []
        self._stderr: list[str] = []
        self._result: asyncio.Future[CommandResult] = (
            asyncio.get_running_loop().create_future()
        )
        # Mark the result retrieved so an unawaited failure (e.g. close()
        # before wait()) doesn't log a noisy "exception never retrieved".
        self._result.add_done_callback(_retrieve_exception)
        self._reader = asyncio.create_task(self._read_loop())

    async def kill(self, signal: str = "SIGTERM") -> None:
        """Send a POSIX signal to the process (default ``"SIGTERM"``)."""
        await self._ws.send(json.dumps({"type": "signal", "name": signal}))

    async def wait(self) -> CommandResult:
        """Resolve with the final result; raise if the connection drops first."""
        return await self._result

    async def close(self) -> None:
        """Kill the process and close the connection."""
        if not self._result.done():
            with contextlib.suppress(Exception):
                await self.kill()
        self._reader.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await self._reader
        # Settle wait() directly in case the reader was cancelled before it
        # started (so its finally never ran) — wait() must never hang.
        if not self._result.done():
            self._result.set_exception(SandboxError("exec/connect: session closed"))
        with contextlib.suppress(Exception):
            await self._ws.close()

    async def __aenter__(self) -> AsyncCommandSession:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    async def _read_loop(self) -> None:
        try:
            async for message in self._ws:
                if isinstance(message, str):
                    self._on_lifecycle(message)
                    if self._result.done():
                        break
                else:
                    self._on_binary(message)
        except Exception:
            pass
        finally:
            # Runs even on task cancellation (e.g. close()), so wait() is always
            # settled and the socket is always closed — never a hang or a leak.
            if not self._result.done():
                self._flush()
                self._result.set_exception(
                    SandboxError(
                        "exec/connect: connection closed before the command finished"
                    )
                )
            with contextlib.suppress(Exception):
                await self._ws.close()

    def _on_binary(self, message: bytes) -> None:
        if not message:
            return
        channel, payload = message[0], message[1:]
        if channel == _CH_STDOUT:
            text = self._out_decoder.decode(payload)
            if text:
                self._stdout.append(text)
                if self._on_stdout:
                    self._on_stdout(text)
        elif channel == _CH_STDERR:
            text = self._err_decoder.decode(payload)
            if text:
                self._stderr.append(text)
                if self._on_stderr:
                    self._on_stderr(text)

    def _on_lifecycle(self, raw: str) -> None:
        try:
            ev = json.loads(raw)
        except json.JSONDecodeError:
            return
        if ev.get("error"):
            self._stderr.append(ev["error"])
        if ev.get("finished") and not self._result.done():
            self._flush()
            self._result.set_result(
                CommandResult(
                    stdout="".join(self._stdout),
                    stderr="".join(self._stderr),
                    exit_code=ev.get("exit_code", 0),
                )
            )

    def _flush(self) -> None:
        tail_out = self._out_decoder.decode(b"", final=True)
        if tail_out:
            self._stdout.append(tail_out)
        tail_err = self._err_decoder.decode(b"", final=True)
        if tail_err:
            self._stderr.append(tail_err)
