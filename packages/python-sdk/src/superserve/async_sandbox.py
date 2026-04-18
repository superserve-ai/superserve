"""Async Sandbox class for the Superserve Python SDK."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ._config import ResolvedConfig, resolve_config
from ._http import async_api_request
from ._polling import async_wait_for_status
from .commands import AsyncCommands
from .errors import NotFoundError
from .files import AsyncFiles
from .types import NetworkConfig, SandboxInfo, SandboxStatus, to_sandbox_info


class AsyncSandbox:
    """Async variant of Sandbox with identical API surface."""

    def __init__(self, info: SandboxInfo, config: ResolvedConfig) -> None:
        self.id: str = info.id
        self.name: str = info.name
        self.status: SandboxStatus = info.status
        self.metadata: Dict[str, str] = info.metadata
        self.access_token: str = info.access_token
        self._config = config

        self.commands = AsyncCommands(config.base_url, self.id, config.api_key)
        self.files = AsyncFiles(self.id, config.sandbox_host, self.access_token)

    @classmethod
    async def create(
        cls,
        *,
        name: str,
        from_snapshot: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
        metadata: Optional[Dict[str, str]] = None,
        env_vars: Optional[Dict[str, str]] = None,
        network: Optional[NetworkConfig] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> AsyncSandbox:
        """Create a new sandbox."""
        config = resolve_config(api_key=api_key, base_url=base_url)

        body: Dict[str, Any] = {"name": name}
        if from_snapshot is not None:
            body["from_snapshot"] = from_snapshot
        if timeout_seconds is not None:
            body["timeout_seconds"] = timeout_seconds
        if metadata is not None:
            body["metadata"] = metadata
        if env_vars is not None:
            body["env_vars"] = env_vars
        if network:
            body["network"] = {
                "allow_out": network.allow_out,
                "deny_out": network.deny_out,
            }

        raw = await async_api_request(
            "POST",
            f"{config.base_url}/sandboxes",
            headers={"X-API-Key": config.api_key},
            json_body=body,
        )
        return cls(to_sandbox_info(raw), config)

    @classmethod
    async def connect(
        cls,
        sandbox_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> AsyncSandbox:
        """Connect to an existing sandbox by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        return cls(to_sandbox_info(raw), config)

    @classmethod
    async def list(
        cls,
        *,
        metadata: Optional[Dict[str, str]] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> List[SandboxInfo]:
        """List all sandboxes belonging to the authenticated team."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        url = f"{config.base_url}/sandboxes"
        if metadata:
            from urllib.parse import urlencode
            params = {f"metadata.{k}": v for k, v in metadata.items()}
            url += f"?{urlencode(params)}"

        raw = await async_api_request(
            "GET", url, headers={"X-API-Key": config.api_key}
        )
        return [to_sandbox_info(item) for item in raw]

    @classmethod
    async def get(
        cls,
        sandbox_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> SandboxInfo:
        """Get sandbox info by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        return to_sandbox_info(raw)

    @classmethod
    async def kill_by_id(
        cls,
        sandbox_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        """Delete a sandbox by ID. Idempotent."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        try:
            await async_api_request(
                "DELETE",
                f"{config.base_url}/sandboxes/{sandbox_id}",
                headers={"X-API-Key": config.api_key},
            )
        except NotFoundError:
            pass  # Already deleted

    # Instance methods

    def _refresh_from(self, info: SandboxInfo) -> None:
        """Update instance state from fresh API response."""
        if info.access_token and info.access_token != self.access_token:
            self.access_token = info.access_token
            self.files = AsyncFiles(self.id, self._config.sandbox_host, self.access_token)

    async def get_info(self) -> SandboxInfo:
        """Refresh this sandbox's info from the API."""
        raw = await async_api_request(
            "GET",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
        )
        info = to_sandbox_info(raw)
        self._refresh_from(info)
        return info

    async def pause(self) -> SandboxInfo:
        """Pause this sandbox."""
        raw = await async_api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/pause",
            headers={"X-API-Key": self._config.api_key},
        )
        info = to_sandbox_info(raw)
        self._refresh_from(info)
        return info

    async def resume(self) -> SandboxInfo:
        """Resume this sandbox from paused state."""
        raw = await async_api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/resume",
            headers={"X-API-Key": self._config.api_key},
        )
        info = to_sandbox_info(raw)
        self._refresh_from(info)
        return info

    async def kill(self) -> None:
        """Delete this sandbox and all its resources. Idempotent."""
        try:
            await async_api_request(
                "DELETE",
                f"{self._config.base_url}/sandboxes/{self.id}",
                headers={"X-API-Key": self._config.api_key},
            )
        except NotFoundError:
            pass  # Already deleted

    async def update(
        self,
        *,
        metadata: Optional[Dict[str, str]] = None,
        network: Optional[NetworkConfig] = None,
    ) -> None:
        """Partially update this sandbox."""
        body: Dict[str, Any] = {}
        if metadata is not None:
            body["metadata"] = metadata
        if network is not None:
            body["network"] = {
                "allow_out": network.allow_out,
                "deny_out": network.deny_out,
            }

        await async_api_request(
            "PATCH",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
            json_body=body,
        )
        if metadata is not None:
            self.metadata = metadata

    async def wait_for_ready(self, timeout_seconds: float = 60.0) -> SandboxInfo:
        """Wait for this sandbox to reach active status."""
        info = await async_wait_for_status(
            self.id, SandboxStatus.ACTIVE, self._config, timeout_seconds=timeout_seconds
        )
        self._refresh_from(info)
        return info

    def __repr__(self) -> str:
        return f"AsyncSandbox(id={self.id!r}, name={self.name!r}, status={self.status.value!r})"

    async def __aenter__(self) -> AsyncSandbox:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.kill()
