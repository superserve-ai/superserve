"""Async Sandbox class for the Superserve Python SDK."""

from __future__ import annotations

import builtins
from typing import TYPE_CHECKING, Any

import httpx

from ._config import ResolvedConfig, resolve_config
from ._http import async_api_request
from .commands import AsyncCommands
from .errors import NotFoundError, SandboxError
from .files import AsyncFiles
from .types import NetworkConfig, SandboxInfo, SandboxStatus, to_sandbox_info

if TYPE_CHECKING:
    from .async_template import AsyncTemplate
    from .template import Template


class AsyncSandbox:
    """Async variant of Sandbox with identical API surface."""

    def __init__(
        self,
        info: SandboxInfo,
        access_token: str,
        config: ResolvedConfig,
    ) -> None:
        self.id: str = info.id
        self.name: str = info.name
        self.status: SandboxStatus = info.status
        self.metadata: dict[str, str] = info.metadata
        self._access_token: str = access_token
        self._config = config
        self._http_client: httpx.AsyncClient = httpx.AsyncClient(timeout=30.0)
        self._closed = False

        self.commands = AsyncCommands(
            config.base_url, self.id, config.api_key, client=self._http_client
        )
        self.files = AsyncFiles(
            self.id, config.sandbox_host, self._access_token, client=self._http_client
        )

    @classmethod
    async def create(
        cls,
        *,
        name: str,
        from_template: "str | Template | AsyncTemplate | None" = None,
        from_snapshot: str | None = None,
        timeout_seconds: int | None = None,
        metadata: dict[str, str] | None = None,
        env_vars: dict[str, str] | None = None,
        network: NetworkConfig | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> AsyncSandbox:
        """Create a new sandbox. Returns once the sandbox is ready."""
        config = resolve_config(api_key=api_key, base_url=base_url)

        body: dict[str, Any] = {"name": name}
        if from_template is not None:
            if isinstance(from_template, str):
                body["from_template"] = from_template
            else:
                # Template / AsyncTemplate instance — extract alias (fallback to id)
                body["from_template"] = (
                    getattr(from_template, "alias", None) or from_template.id
                )
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
        token = raw.get("access_token") if raw else None
        if not token:
            raise SandboxError(
                "Invalid API response from POST /sandboxes: missing access_token"
            )
        return cls(to_sandbox_info(raw), token, config)

    @classmethod
    async def connect(
        cls,
        sandbox_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> AsyncSandbox:
        """Connect to an existing sandbox by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        token = raw.get("access_token") if raw else None
        if not token:
            raise SandboxError(
                "Invalid API response from GET /sandboxes/{id}: missing access_token"
            )
        return cls(to_sandbox_info(raw), token, config)

    @classmethod
    async def list(
        cls,
        *,
        metadata: dict[str, str] | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> builtins.list[SandboxInfo]:
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
    async def kill_by_id(
        cls,
        sandbox_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
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

    # Methods on sandbox

    async def _close_http_client(self) -> None:
        if not self._closed:
            self._closed = True
            try:
                await self._http_client.aclose()
            except Exception:
                pass

    def _require_live(self) -> None:
        if self._closed:
            raise SandboxError(
                f"Sandbox {self.id!r} has been deleted; create or connect to "
                "a new one."
            )

    async def get_info(self) -> SandboxInfo:
        """Refresh this sandbox's info from the API."""
        self._require_live()
        raw = await async_api_request(
            "GET",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        return to_sandbox_info(raw)

    async def pause(self) -> None:
        """Pause this sandbox. The sandbox transitions to ``paused``."""
        self._require_live()
        await async_api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/pause",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )

    async def resume(self) -> None:
        """Resume a paused sandbox.

        The access token is rotated; the SDK rebuilds ``sandbox.files`` with
        the fresh token transparently.
        """
        self._require_live()
        raw = await async_api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/resume",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        token = raw.get("access_token") if raw else None
        if not token:
            raise SandboxError(
                "Invalid API response from POST /sandboxes/{id}/resume: "
                "missing access_token"
            )
        self._access_token = token
        self.files = AsyncFiles(
            self.id,
            self._config.sandbox_host,
            self._access_token,
            client=self._http_client,
        )

    async def kill(self) -> None:
        """Delete this sandbox and all its resources. Idempotent."""
        if self._closed:
            return
        try:
            await async_api_request(
                "DELETE",
                f"{self._config.base_url}/sandboxes/{self.id}",
                headers={"X-API-Key": self._config.api_key},
                client=self._http_client,
            )
        except NotFoundError:
            pass  # Already deleted
        finally:
            await self._close_http_client()

    async def update(
        self,
        *,
        metadata: dict[str, str] | None = None,
        network: NetworkConfig | None = None,
    ) -> None:
        """Partially update this sandbox."""
        self._require_live()
        body: dict[str, Any] = {}
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
            client=self._http_client,
        )

    def __repr__(self) -> str:
        return (
            f"AsyncSandbox(id={self.id!r}, name={self.name!r}, "
            f"status={self.status.value!r})"
        )
