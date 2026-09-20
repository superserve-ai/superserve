from datetime import datetime, timezone
import io
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from agents.sandbox.manifest import Manifest
from agents.sandbox.snapshot import resolve_snapshot
from superserve.errors import NotFoundError
from superserve.types import CommandResult, PreviewAccess, SandboxInfo, SandboxStatus
from superserve_agents_openai.client import SuperserveSandboxSessionState
from superserve_agents_openai.session import SuperserveSandboxSession


@pytest.fixture
def mock_sandbox():
    sandbox = MagicMock()
    sandbox.id = "sbx_test_123"
    sandbox._closed = False
    sandbox.commands = MagicMock()
    sandbox.commands.run = AsyncMock(
        return_value=CommandResult(stdout="hello\n", stderr="", exit_code=0)
    )
    sandbox.files = MagicMock()
    sandbox.files.read = AsyncMock(return_value=b"file content")
    sandbox.files.write = AsyncMock(return_value=None)
    sandbox.get_info = AsyncMock(
        return_value=SandboxInfo(
            id="sbx_test_123",
            name="test-sandbox",
            status=SandboxStatus.ACTIVE,
            created_at=datetime(2026, 9, 10, 12, 0, 0, tzinfo=timezone.utc),
            preview_access=PreviewAccess("private"),
        )
    )
    return sandbox


@pytest.fixture
def session(mock_sandbox):
    session_id = uuid.uuid4()
    manifest = Manifest(root="/workspace")
    snapshot = resolve_snapshot(None, str(session_id))
    state = SuperserveSandboxSessionState(
        session_id=session_id,
        sandbox_id=mock_sandbox.id,
        manifest=manifest,
        snapshot=snapshot,
        workspace_root_ready=True,
    )
    return SuperserveSandboxSession(state=state, sandbox=mock_sandbox)


@pytest.mark.asyncio
async def test_exec_internal(session, mock_sandbox):
    result = await session._exec_internal("echo", "hello")
    assert result.exit_code == 0
    assert result.stdout == b"hello\n"
    assert result.stderr == b""
    mock_sandbox.commands.run.assert_awaited_once()


@pytest.mark.asyncio
async def test_read(session, mock_sandbox):
    stream = await session.read(Path("/workspace/hello.txt"))
    assert stream.read() == b"file content"
    mock_sandbox.files.read.assert_awaited_once_with("/workspace/hello.txt")


@pytest.mark.asyncio
async def test_write(session, mock_sandbox):
    await session.write(Path("/workspace/hello.txt"), io.BytesIO(b"new content"))
    mock_sandbox.files.write.assert_awaited_once_with(
        "/workspace/hello.txt", b"new content"
    )


@pytest.mark.asyncio
async def test_running(session, mock_sandbox):
    is_running = await session.running()
    assert is_running is True
    mock_sandbox.get_info.assert_awaited_once()


@pytest.mark.asyncio
async def test_running_when_sandbox_closed(session, mock_sandbox):
    mock_sandbox._closed = True
    is_running = await session.running()
    assert is_running is False
    mock_sandbox.get_info.assert_not_called()


@pytest.mark.asyncio
async def test_running_when_not_found(session, mock_sandbox):
    mock_sandbox.get_info.side_effect = NotFoundError("sandbox not found")
    is_running = await session.running()
    assert is_running is False


@pytest.mark.asyncio
async def test_running_when_unexpected_error(session, mock_sandbox):
    mock_sandbox.get_info.side_effect = RuntimeError("network outage")
    is_running = await session.running()
    assert is_running is False



@pytest.mark.asyncio
async def test_read_not_found(session, mock_sandbox):
    from agents.sandbox.errors import WorkspaceReadNotFoundError
    from superserve.errors import NotFoundError

    mock_sandbox.files.read.side_effect = NotFoundError("file not found")
    with pytest.raises(WorkspaceReadNotFoundError):
        await session.read(Path("/workspace/missing.txt"))


@pytest.mark.asyncio
async def test_write_invalid_type(session):
    from agents.sandbox.errors import WorkspaceWriteTypeError

    bad_stream = MagicMock()
    bad_stream.read.return_value = 12345  # Not bytes or str
    with pytest.raises(WorkspaceWriteTypeError):
        await session.write(Path("/workspace/test.txt"), bad_stream)


@pytest.mark.asyncio
async def test_read_archive_error(session, mock_sandbox):
    from agents.sandbox.errors import WorkspaceArchiveReadError

    mock_sandbox.files.read.side_effect = RuntimeError("network failure")
    with pytest.raises(WorkspaceArchiveReadError):
        await session.read(Path("/workspace/error.txt"))


@pytest.mark.asyncio
async def test_write_archive_error(session, mock_sandbox):
    from agents.sandbox.errors import WorkspaceArchiveWriteError

    mock_sandbox.files.write.side_effect = RuntimeError("write failure")
    with pytest.raises(WorkspaceArchiveWriteError):
        await session.write(Path("/workspace/error.txt"), io.BytesIO(b"data"))


@pytest.mark.asyncio
async def test_exec_timeout(session, mock_sandbox):
    from agents.sandbox.errors import ExecTimeoutError
    from superserve.errors import SandboxTimeoutError

    mock_sandbox.commands.run.side_effect = SandboxTimeoutError("timed out")
    with pytest.raises(ExecTimeoutError):
        await session._exec_internal("sleep", "10", timeout=2.0)


@pytest.mark.asyncio
async def test_exec_transport_error(session, mock_sandbox):
    from agents.sandbox.errors import ExecTransportError

    mock_sandbox.commands.run.side_effect = RuntimeError("connection reset")
    with pytest.raises(ExecTransportError):
        await session._exec_internal("ls")


@pytest.mark.asyncio
async def test_exec_empty_command(session, mock_sandbox):
    res = await session._exec_internal()
    assert res.exit_code == 0
    assert res.stdout == b""
    assert res.stderr == b""
    mock_sandbox.commands.run.assert_not_called()


@pytest.mark.asyncio
async def test_shutdown_safe(session, mock_sandbox):
    mock_sandbox.kill = AsyncMock(side_effect=RuntimeError("kill failed"))
    # Should complete safely without raising an exception
    await session.shutdown()
    mock_sandbox.kill.assert_awaited_once()

