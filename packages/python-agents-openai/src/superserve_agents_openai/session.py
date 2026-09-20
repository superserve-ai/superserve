from __future__ import annotations

import io
import logging
import math
import shlex
from pathlib import Path
from typing import TYPE_CHECKING

from agents.sandbox.errors import (
    ExecTimeoutError,
    ExecTransportError,
    WorkspaceArchiveReadError,
    WorkspaceArchiveWriteError,
    WorkspaceReadNotFoundError,
    WorkspaceWriteTypeError,
)
from agents.sandbox.session.base_sandbox_session import BaseSandboxSession
from agents.sandbox.types import ExecResult, User
from agents.sandbox.workspace_paths import posix_path_for_error, sandbox_path_str
from superserve.errors import NotFoundError, SandboxTimeoutError
from superserve.types import SandboxStatus

if TYPE_CHECKING:
    from superserve import AsyncSandbox
    from .client import SuperserveSandboxSessionState

logger = logging.getLogger(__name__)


class SuperserveSandboxSession(BaseSandboxSession):
    """Superserve microVM sandbox session implementation."""

    state: SuperserveSandboxSessionState
    _sandbox: AsyncSandbox

    def __init__(
        self,
        *,
        state: SuperserveSandboxSessionState,
        sandbox: AsyncSandbox,
    ) -> None:
        self.state = state
        self._sandbox = sandbox

    async def _after_start(self) -> None:
        await super()._after_start()
        self.state.workspace_root_ready = True

    def _mark_workspace_root_ready_from_probe(self) -> None:
        super()._mark_workspace_root_ready_from_probe()
        self.state.workspace_root_ready = True

    async def _shutdown_backend(self) -> None:
        """Release underlying sandbox microVM resources."""
        try:
            await self._sandbox.kill()
        except Exception as e:
            logger.warning("Failed to cleanly kill sandbox microVM: %s", e)

    async def _exec_internal(
        self,
        *command: str | Path,
        timeout: float | None = None,
    ) -> ExecResult:
        command_list = [str(c) for c in command]
        if not command_list:
            return ExecResult(exit_code=0, stdout=b"", stderr=b"")

        cmd_str = (
            command_list[0] if len(command_list) == 1 else shlex.join(command_list)
        )
        cwd = (
            str(self.state.manifest.root)
            if (self.state.workspace_root_ready and self.state.manifest.root)
            else None
        )
        timeout_seconds = max(1, math.ceil(timeout)) if timeout is not None else None

        try:
            res = await self._sandbox.commands.run(
                cmd_str,
                cwd=cwd,
                timeout_seconds=timeout_seconds,
            )
        except SandboxTimeoutError as e:
            raise ExecTimeoutError(
                command=command,
                timeout_s=timeout,
                cause=e,
            ) from e
        except Exception as e:
            raise ExecTransportError(
                command=command,
                cause=e,
                message=str(e),
            ) from e

        return ExecResult(
            exit_code=res.exit_code,
            stdout=res.stdout.encode("utf-8", errors="replace"),
            stderr=res.stderr.encode("utf-8", errors="replace"),
        )

    async def read(
        self,
        path: Path,
        *,
        user: str | User | None = None,
    ) -> io.IOBase:
        if user is not None:
            await self._check_read_with_exec(path, user=user)

        workspace_path = await self._validate_path_access(path)
        path_str = sandbox_path_str(workspace_path)
        if not path_str.startswith("/"):
            path_str = f"/{path_str}"

        try:
            content = await self._sandbox.files.read(path_str)
            return io.BytesIO(content)
        except NotFoundError as e:
            raise WorkspaceReadNotFoundError(path=posix_path_for_error(path), cause=e) from e
        except Exception as e:
            raise WorkspaceArchiveReadError(path=posix_path_for_error(path), cause=e) from e

    async def write(
        self,
        path: Path,
        data: io.IOBase,
        *,
        user: str | User | None = None,
    ) -> None:
        if user is not None:
            await self._check_write_with_exec(path, user=user)

        workspace_path = await self._validate_path_access(path, for_write=True)
        path_str = sandbox_path_str(workspace_path)
        if not path_str.startswith("/"):
            path_str = f"/{path_str}"

        payload = data.read()
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        if not isinstance(payload, bytes | bytearray):
            raise WorkspaceWriteTypeError(
                path=posix_path_for_error(path),
                actual_type=type(payload).__name__,
            )

        try:
            await self._sandbox.files.write(path_str, bytes(payload))
        except Exception as e:
            raise WorkspaceArchiveWriteError(
                path=posix_path_for_error(workspace_path),
                cause=e,
            ) from e

    async def running(self) -> bool:
        if getattr(self._sandbox, "_closed", False):
            return False
        try:
            info = await self._sandbox.get_info()
            return info.status in (
                SandboxStatus.ACTIVE,
                SandboxStatus.STARTING,
                SandboxStatus.RESUMING,
            )
        except NotFoundError:
            return False
        except Exception as e:
            logger.warning("Unexpected error querying sandbox running status: %s", e)
            return False

    async def persist_workspace(self) -> io.IOBase:
        raise NotImplementedError(
            "Superserve sandbox workspace snapshot persistence is not supported"
        )

    async def hydrate_workspace(self, data: io.IOBase) -> None:
        raise NotImplementedError(
            "Superserve sandbox workspace hydration is not supported"
        )
