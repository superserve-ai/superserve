"""Sync Sandbox class — primary entry point for the Superserve Python SDK."""

from __future__ import annotations

import builtins
from typing import Any

import httpx

from ._config import ResolvedConfig, resolve_config
from ._http import api_request
from .commands import Commands
from .errors import NotFoundError, SandboxError
from .files import Files
from .types import NetworkConfig, SandboxInfo, SandboxStatus, to_sandbox_info


class Sandbox:
    """A live sandbox - call methods directly (`sandbox.commands.run(...)`, etc.)."""

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
        self._http_client: httpx.Client = httpx.Client(timeout=30.0)
        self._closed = False

        self.commands = Commands(
            config.base_url, self.id, config.api_key, client=self._http_client
        )
        self.files = Files(
            self.id, config.sandbox_host, self._access_token, client=self._http_client
        )

    @classmethod
    def create(
        cls,
        *,
        name: str,
        timeout_seconds: int | None = None,
        metadata: dict[str, str] | None = None,
        env_vars: dict[str, str] | None = None,
        network: NetworkConfig | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> Sandbox:
        """Create a new sandbox. Returns once the sandbox is ready."""
        config = resolve_config(api_key=api_key, base_url=base_url)

        body: dict[str, Any] = {"name": name}
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
        token = raw.get("access_token") if raw else None
        if not token:
            raise SandboxError(
                "Invalid API response from POST /sandboxes: missing access_token"
            )
        return cls(to_sandbox_info(raw), token, config)

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
        token = raw.get("access_token") if raw else None
        if not token:
            raise SandboxError(
                "Invalid API response from GET /sandboxes/{id}: missing access_token"
            )
        return cls(to_sandbox_info(raw), token, config)

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

    # Methods on sandbox

    def _close_http_client(self) -> None:
        if not self._closed:
            self._closed = True
            try:
                self._http_client.close()
            except Exception:
                pass

    def _require_live(self) -> None:
        if self._closed:
            raise SandboxError(
                f"Sandbox {self.id!r} has been deleted; create or connect to "
                "a new one."
            )

    def get_info(self) -> SandboxInfo:
        """Refresh this sandbox's info from the API."""
        self._require_live()
        raw = api_request(
            "GET",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        return to_sandbox_info(raw)

    def pause(self) -> None:
        """Pause this sandbox. The sandbox transitions to ``paused``."""
        self._require_live()
        api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/pause",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )

    def resume(self) -> None:
        """Resume a paused sandbox.

        The access token is rotated; the SDK rebuilds ``sandbox.files`` with
        the fresh token transparently.
        """
        self._require_live()
        raw = api_request(
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
        self.files = Files(
            self.id,
            self._config.sandbox_host,
            self._access_token,
            client=self._http_client,
        )

    def kill(self) -> None:
        """Delete this sandbox and all its resources. Idempotent."""
        if self._closed:
            return
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
        self._require_live()
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

    def __repr__(self) -> str:
        return (
            f"Sandbox(id={self.id!r}, name={self.name!r}, "
            f"status={self.status.value!r})"
        )
