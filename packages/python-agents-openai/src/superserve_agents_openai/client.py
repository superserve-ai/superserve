from __future__ import annotations

import uuid
from typing import Literal

from agents.sandbox.manifest import Manifest
from agents.sandbox.session.sandbox_client import BaseSandboxClient
from agents.sandbox.session.sandbox_session import SandboxSession
from agents.sandbox.session.sandbox_session_state import SandboxSessionState
from agents.sandbox.snapshot import SnapshotBase, SnapshotSpec, resolve_snapshot
from superserve.async_sandbox import AsyncSandbox

from .options import SuperserveSandboxClientOptions
from .session import SuperserveSandboxSession


class SuperserveSandboxSessionState(SandboxSessionState):
    """Persisted session state for Superserve sandbox."""

    type: Literal["superserve"] = "superserve"
    sandbox_id: str | None = None


class SuperserveSandboxClient(BaseSandboxClient[SuperserveSandboxClientOptions]):
    backend_id: str = "superserve"
    supports_default_options: bool = True

    def __init__(
        self,
        default_options: SuperserveSandboxClientOptions | None = None,
    ) -> None:
        self._default_options = default_options or SuperserveSandboxClientOptions()

    def deserialize_session_state(
        self, payload: dict[str, object]
    ) -> SandboxSessionState:
        return self._deserialize_session_state_payload(
            payload, SuperserveSandboxSessionState
        )

    async def create(
        self,
        *,
        snapshot: SnapshotSpec | SnapshotBase | None = None,
        manifest: Manifest | None = None,
        options: SuperserveSandboxClientOptions | None = None,
    ) -> SandboxSession:
        opts = options or self._default_options
        manifest = manifest if manifest is not None else Manifest()
        self._validate_manifest_for_create(manifest)

        manifest_envs = await manifest.environment.resolve()
        base_envs = dict(opts.env_vars or {})
        envs = {**base_envs, **manifest_envs} or None

        sandbox_name = f"openai-agent-{uuid.uuid4().hex[:8]}"

        sandbox = await AsyncSandbox.create(
            name=sandbox_name,
            from_template=opts.template,
            timeout_seconds=opts.timeout_seconds,
            auto_delete_seconds=opts.auto_delete_seconds,
            metadata=opts.metadata,
            env_vars=envs,
            api_key=opts.api_key,
            base_url=opts.base_url,
        )

        try:
            session_id = uuid.uuid4()
            snapshot_instance = resolve_snapshot(snapshot, str(session_id))
            state = SuperserveSandboxSessionState(
                session_id=session_id,
                manifest=manifest,
                snapshot=snapshot_instance,
                sandbox_id=sandbox.id,
            )

            inner = SuperserveSandboxSession(state=state, sandbox=sandbox)
            return self._wrap_session(inner)
        except BaseException:
            await sandbox.kill()
            raise

    async def delete(self, session: SandboxSession) -> SandboxSession:
        await session.shutdown()
        return session

    async def resume(self, state: SandboxSessionState) -> SandboxSession:
        raise NotImplementedError(
            "Session resume is not yet supported for Superserve sandboxes"
        )
