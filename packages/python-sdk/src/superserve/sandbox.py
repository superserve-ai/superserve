"""Sync Sandbox class — primary entry point for the Superserve Python SDK."""

from __future__ import annotations

import builtins
from typing import Any

import httpx

from ._config import ResolvedConfig, resolve_config
from ._http import api_request
from ._polling import wait_for_status
from .commands import Commands
from .errors import NotFoundError, SandboxError
from .files import Files
from .types import NetworkConfig, SandboxInfo, SandboxStatus, to_sandbox_info


class Sandbox:
    """A connected sandbox instance with lifecycle methods and sub-modules."""

    def __init__(self, info: SandboxInfo, config: ResolvedConfig) -> None:
        if not info.access_token:
            raise SandboxError(
                "Invalid API response: missing access_token "
                "(required for a live Sandbox instance)"
            )
        self.id: str = info.id
        self.name: str = info.name
        self.status: SandboxStatus = info.status
        self.metadata: dict[str, str] = info.metadata
        self.access_token: str = info.access_token
        self._config = config
        self._http_client: httpx.Client = httpx.Client(timeout=30.0)
        self._closed = False

        self.commands = Commands(
            config.base_url, self.id, config.api_key, client=self._http_client
        )
        self.files = Files(
            self.id, config.sandbox_host, self.access_token, client=self._http_client
        )

    @classmethod
    def create(
        cls,
        *,
        name: str,
        from_snapshot: str | None = None,
        timeout_seconds: int | None = None,
        metadata: dict[str, str] | None = None,
        env_vars: dict[str, str] | None = None,
        network: NetworkConfig | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> Sandbox:
        """Create a new sandbox."""
        config = resolve_config(api_key=api_key, base_url=base_url)

        body: dict[str, Any] = {"name": name}
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

        raw = api_request(
            "POST",
            f"{config.base_url}/sandboxes",
            headers={"X-API-Key": config.api_key},
            json_body=body,
        )
        return cls(to_sandbox_info(raw), config)

    @classmethod
    def connect(
        cls,
        sandbox_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> Sandbox:
        """Connect to an existing sandbox by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        return cls(to_sandbox_info(raw), config)

    @classmethod
    def list(
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

        raw = api_request("GET", url, headers={"X-API-Key": config.api_key})
        return [to_sandbox_info(item) for item in raw]

    @classmethod
    def get(
        cls,
        sandbox_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> SandboxInfo:
        """Get sandbox info by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        return to_sandbox_info(raw)

    @classmethod
    def kill_by_id(
        cls,
        sandbox_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        """Delete a sandbox by ID. Idempotent."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        try:
            api_request(
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
            self.files = Files(
                self.id,
                self._config.sandbox_host,
                self.access_token,
                client=self._http_client,
            )

    def _close_http_client(self) -> None:
        if not self._closed:
            self._closed = True
            try:
                self._http_client.close()
            except Exception:
                pass

    def get_info(self) -> SandboxInfo:
        """Refresh this sandbox's info from the API."""
        raw = api_request(
            "GET",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        info = to_sandbox_info(raw)
        self._refresh_from(info)
        return info

    def pause(self) -> SandboxInfo:
        """Pause this sandbox."""
        raw = api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/pause",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        info = to_sandbox_info(raw)
        self._refresh_from(info)
        return info

    def resume(self) -> SandboxInfo:
        """Resume this sandbox from paused state."""
        raw = api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/resume",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        info = to_sandbox_info(raw)
        self._refresh_from(info)
        return info

    def kill(self) -> None:
        """Delete this sandbox and all its resources. Idempotent."""
        try:
            api_request(
                "DELETE",
                f"{self._config.base_url}/sandboxes/{self.id}",
                headers={"X-API-Key": self._config.api_key},
                client=self._http_client,
            )
        except NotFoundError:
            pass  # Already deleted
        finally:
            self._close_http_client()

    def update(
        self,
        *,
        metadata: dict[str, str] | None = None,
        network: NetworkConfig | None = None,
    ) -> None:
        """Partially update this sandbox."""
        body: dict[str, Any] = {}
        if metadata is not None:
            body["metadata"] = metadata
        if network is not None:
            body["network"] = {
                "allow_out": network.allow_out,
                "deny_out": network.deny_out,
            }

        api_request(
            "PATCH",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
            json_body=body,
            client=self._http_client,
        )

    def wait_for_ready(self, timeout_seconds: float = 60.0) -> SandboxInfo:
        """Wait for this sandbox to reach active status."""
        info = wait_for_status(
            self.id,
            SandboxStatus.ACTIVE,
            self._config,
            timeout_seconds=timeout_seconds,
            client=self._http_client,
        )
        self._refresh_from(info)
        return info

    def __repr__(self) -> str:
        return f"Sandbox(id={self.id!r}, name={self.name!r}, status={self.status.value!r})"

    def __enter__(self) -> Sandbox:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.kill()
