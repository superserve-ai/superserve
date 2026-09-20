from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from agents.sandbox.manifest import Manifest
from agents.sandbox.session.sandbox_session import SandboxSession
from superserve.types import PreviewAccess, SandboxInfo, SandboxStatus
from superserve_agents_openai import (
    SuperserveSandboxClient,
    SuperserveSandboxClientOptions,
)
from superserve_agents_openai.client import SuperserveSandboxSessionState
from superserve_agents_openai.session import SuperserveSandboxSession


@pytest.fixture
def mock_async_sandbox():
    sandbox = AsyncMock()
    sandbox.id = "sbx_test_456"
    sandbox.kill = AsyncMock(return_value=None)
    sandbox.get_info = AsyncMock(
        return_value=SandboxInfo(
            id="sbx_test_456",
            name="openai-agent-sandbox",
            status=SandboxStatus.ACTIVE,
            created_at=datetime(2026, 9, 10, 12, 0, 0, tzinfo=timezone.utc),
            preview_access=PreviewAccess("private"),
        )
    )
    return sandbox


@pytest.mark.asyncio
async def test_client_create_and_delete(mock_async_sandbox):
    client = SuperserveSandboxClient(
        SuperserveSandboxClientOptions(api_key="ss_test_key")
    )
    manifest = Manifest(root="/workspace")

    with patch(
        "superserve.async_sandbox.AsyncSandbox.create",
        new_callable=AsyncMock,
        return_value=mock_async_sandbox,
    ) as mock_create:
        session = await client.create(manifest=manifest)
        assert isinstance(session, SandboxSession)
        inner = getattr(session, "_inner", session)
        assert isinstance(inner, SuperserveSandboxSession)
        assert inner.state.sandbox_id == "sbx_test_456"
        assert isinstance(session.state, SuperserveSandboxSessionState)
        assert session.state.sandbox_id == "sbx_test_456"
        mock_create.assert_awaited_once()

        # Test delete
        deleted_session = await client.delete(session)
        assert deleted_session is session
        mock_async_sandbox.kill.assert_awaited_once()


@pytest.mark.asyncio
async def test_client_create_failure_kills_sandbox(mock_async_sandbox):
    client = SuperserveSandboxClient(
        SuperserveSandboxClientOptions(api_key="ss_test_key")
    )
    with patch(
        "superserve.async_sandbox.AsyncSandbox.create",
        new_callable=AsyncMock,
        return_value=mock_async_sandbox,
    ), patch(
        "superserve_agents_openai.client.resolve_snapshot",
        side_effect=RuntimeError("Snapshot resolution failed"),
    ):
        with pytest.raises(RuntimeError, match="Snapshot resolution failed"):
            await client.create()

        mock_async_sandbox.kill.assert_awaited_once()



def test_sandbox_run_config_accepts_client():
    from agents.sandbox import SandboxRunConfig

    client = SuperserveSandboxClient()
    config = SandboxRunConfig(client=client)
    assert config.client is client


def test_deserialize_session_state():
    import uuid
    from agents.sandbox.snapshot import resolve_snapshot
    from superserve_agents_openai.client import SuperserveSandboxSessionState

    client = SuperserveSandboxClient()
    orig_state = SuperserveSandboxSessionState(
        session_id=uuid.uuid4(),
        sandbox_id="sbx_test_deserialized",
        manifest=Manifest(root="/workspace"),
        snapshot=resolve_snapshot(None, "dummy"),
    )
    payload = orig_state.model_dump(mode="json")
    state = client.deserialize_session_state(payload)
    assert isinstance(state, SuperserveSandboxSessionState)
    assert state.sandbox_id == "sbx_test_deserialized"
    assert state.session_id == orig_state.session_id


@pytest.mark.asyncio
async def test_resume_not_implemented():
    import uuid
    from agents.sandbox.snapshot import resolve_snapshot
    from superserve_agents_openai.client import SuperserveSandboxSessionState

    client = SuperserveSandboxClient()
    state = SuperserveSandboxSessionState(
        session_id=uuid.uuid4(),
        sandbox_id="sbx_123",
        manifest=Manifest(root="/workspace"),
        snapshot=resolve_snapshot(None, "dummy"),
    )
    with pytest.raises(NotImplementedError, match="Session resume is not yet supported"):
        await client.resume(state)

