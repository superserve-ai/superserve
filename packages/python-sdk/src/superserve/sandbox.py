"""Sync Sandbox class — primary entry point for the Superserve Python SDK."""

from __future__ import annotations

import builtins
import threading
from typing import TYPE_CHECKING, Any
from urllib.parse import quote, urlencode

import httpx

from ._config import ResolvedConfig, resolve_config
from ._http import api_request
from .commands import Commands, CommandsDeps
from .errors import (
    ImageBuildingError,
    NotFoundError,
    SandboxError,
    ValidationError,
)
from .files import Files
from .types import (
    NetworkConfig,
    NetworkLogPage,
    NetworkVerdict,
    SandboxInfo,
    SandboxSecretBinding,
    SandboxStatus,
    to_network_log_page,
    to_sandbox_info,
)

if TYPE_CHECKING:
    from .async_template import AsyncTemplate
    from .template import Template


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
        # Secrets bound at construction time; call get_info() to refresh.
        self.secrets: list[SandboxSecretBinding] | None = info.secrets
        self._access_token: str = access_token
        self._config = config
        self._http_client: httpx.Client = httpx.Client(timeout=30.0)
        self._closed = False
        self._refresh_lock = threading.Lock()

        self.commands = Commands(
            CommandsDeps(
                sandbox_id=self.id,
                sandbox_host=config.sandbox_host,
                get_access_token=lambda: self._access_token,
                refresh_activate=self._refresh_activate,
            ),
            client=self._http_client,
        )
        self.files = Files(
            self.id, config.sandbox_host, self._access_token, client=self._http_client
        )

    def _post_and_rotate_token(self, endpoint: str) -> str:
        """POST a token-rotating endpoint (``resume`` or ``activate``), update
        the cached token, rebuild ``self.files`` with the fresh token.
        Returns the new token.
        """
        raw = api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/{endpoint}",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        token = raw.get("access_token") if raw else None
        if not isinstance(token, str) or not token:
            raise SandboxError(
                f"Invalid API response from POST /sandboxes/{self.id}/{endpoint}: "
                "missing access_token"
            )
        self._access_token = token
        self.files = Files(
            self.id,
            self._config.sandbox_host,
            self._access_token,
            client=self._http_client,
        )
        return token

    def _refresh_activate(self) -> str:
        """Slow-path fallback for data-plane AuthenticationError. Lock
        serializes refreshes so concurrent callers don't race the
        server-side BeginResume claim (the loser gets 409).
        """
        with self._refresh_lock:
            return self._post_and_rotate_token("activate")

    @classmethod
    def create(
        cls,
        *,
        name: str,
        from_template: "str | Template | AsyncTemplate | None" = None,
        from_snapshot: str | None = None,
        image: str | None = None,
        command: list[str] | None = None,
        vcpu: int | None = None,
        memory_mib: int | None = None,
        disk_mib: int | None = None,
        timeout_seconds: int | None = None,
        metadata: dict[str, str] | None = None,
        env_vars: dict[str, str] | None = None,
        secrets: dict[str, str] | None = None,
        network: NetworkConfig | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> Sandbox:
        """Create a new sandbox. Returns once the sandbox is ready.

        ``secrets`` binds team-stored secrets to environment variables as
        ``{ENV_VAR: secret_name}``: the agent sees a proxy token under each env
        var; the in-host daemon swaps it for the real credential at egress.

        ``image`` brings an OCI image directly (sugar over
        ``POST /sandboxes/from-image``), mutually exclusive with
        ``from_template``/``from_snapshot``. On a cache hit a sandbox is created
        and the image's ENTRYPOINT/CMD runs; on a cache miss a one-time template
        build is started and this raises :class:`ImageBuildingError` — retry once
        the build is ready.
        """
        config = resolve_config(api_key=api_key, base_url=base_url)

        if image is not None:
            if from_template is not None or from_snapshot is not None:
                raise ValidationError(
                    "create: `image` is mutually exclusive with "
                    "`from_template`/`from_snapshot`."
                )
            image_body: dict[str, Any] = {"image": image, "name": name}
            if command is not None:
                image_body["command"] = command
            if env_vars is not None:
                image_body["env"] = env_vars
            if vcpu is not None:
                image_body["vcpu"] = vcpu
            if memory_mib is not None:
                image_body["memory_mib"] = memory_mib
            if disk_mib is not None:
                image_body["disk_mib"] = disk_mib
            raw = api_request(
                "POST",
                f"{config.base_url}/sandboxes/from-image",
                headers={"X-API-Key": config.api_key},
                json_body=image_body,
            )
            token = raw.get("access_token") if raw else None
            if token:
                return cls(to_sandbox_info(raw), token, config)
            raise ImageBuildingError(
                (raw or {}).get("message")
                or f'Image "{image}" is not cached yet; a template build was '
                "started. Retry create(image=...) once it is ready.",
                build_id=(raw or {}).get("build_id", ""),
                template_id=(raw or {}).get("template_id", ""),
                resolved_digest=(raw or {}).get("resolved_digest", ""),
            )

        body: dict[str, Any] = {"name": name}
        if from_template is not None:
            if isinstance(from_template, str):
                body["from_template"] = from_template
            else:
                # Template / AsyncTemplate instance — extract name (fallback to id)
                body["from_template"] = (
                    getattr(from_template, "name", None) or from_template.id
                )
        if from_snapshot is not None:
            body["from_snapshot"] = from_snapshot
        if timeout_seconds is not None:
            body["timeout_seconds"] = timeout_seconds
        if metadata is not None:
            body["metadata"] = metadata
        if env_vars is not None:
            body["env_vars"] = env_vars
        if secrets is not None:
            body["secrets"] = secrets
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
        """Connect to an existing sandbox by ID.

        Calls ``POST /activate`` so the returned instance is guaranteed to
        be active (paused sandboxes are auto-resumed) with a fresh access
        token.
        """
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "POST",
            f"{config.base_url}/sandboxes/{sandbox_id}/activate",
            headers={"X-API-Key": config.api_key},
        )
        token = raw.get("access_token") if raw else None
        if not token:
            raise SandboxError(
                f"Invalid API response from POST /sandboxes/{sandbox_id}/activate: "
                "missing access_token"
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
                f"Sandbox {self.id!r} has been deleted; create or connect to a new one."
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
        self._post_and_rotate_token("resume")

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

    def get_network_log(
        self,
        *,
        limit: int | None = None,
        before: str | None = None,
        since: str | None = None,
        verdict: "NetworkVerdict | str | None" = None,
    ) -> NetworkLogPage:
        """The sandbox's network log: every outbound connection it made, newest
        first. ``connection`` rows are raw egress (host, bytes, allow/deny
        verdict); ``request`` rows are credential-injected requests (method,
        path, status, secret used).

        Filter by time window (``since``/``before``) and ``verdict``. Paginate
        by passing the returned ``next_cursor`` as ``before`` while ``has_more``.
        """
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = limit
        if before is not None:
            params["before"] = before
        if since is not None:
            params["since"] = since
        if verdict is not None:
            params["verdict"] = (
                verdict.value if isinstance(verdict, NetworkVerdict) else verdict
            )
        url = f"{self._config.base_url}/sandboxes/{self.id}/network"
        if params:
            url += "?" + urlencode(params)
        raw = api_request(
            "GET",
            url,
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        return to_network_log_page(raw)

    def attach_secret(self, env_key: str, secret_name: str) -> None:
        """Bind a team secret to this sandbox under an environment variable.

        The sandbox sees a stand-in token; the real credential is swapped in for
        outbound requests to the secret's allowed hosts. Takes effect for
        processes started after this call; a paused sandbox applies it on resume.
        """
        self._require_live()
        api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/secrets",
            headers={"X-API-Key": self._config.api_key},
            json_body={"env_key": env_key, "secret_name": secret_name},
            client=self._http_client,
        )

    def detach_secret(self, env_key: str) -> None:
        """Remove a secret binding from this sandbox by its env-var key.

        The stand-in token is revoked, so requests using it are refused — within
        about a minute for a process already running. A paused sandbox applies
        the change on resume.
        """
        self._require_live()
        api_request(
            "DELETE",
            f"{self._config.base_url}/sandboxes/{self.id}/secrets/{quote(env_key, safe='')}",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )

    def __repr__(self) -> str:
        return (
            f"Sandbox(id={self.id!r}, name={self.name!r}, status={self.status.value!r})"
        )
