"""Secret — a team-stored credential injected at egress.

The real value never enters a sandbox. The agent sees a proxy token under an
environment variable; the in-host daemon swaps it for the real credential on
outbound requests to the secret's allowed hosts.

```python
from superserve import Secret, Sandbox

# Built-in provider shortcut — auth + hosts are preconfigured.
Secret.create(name="anthropic-prod", value=key, provider="anthropic")

# Bind it to a sandbox under an env var the agent reads.
sandbox = Sandbox.create(
    name="agent-1",
    secrets={"ANTHROPIC_API_KEY": "anthropic-prod"},
)
```
"""

from __future__ import annotations

import builtins
from typing import Any, Optional
from urllib.parse import quote, urlencode

from ._config import ResolvedConfig, resolve_config
from ._http import api_request
from .errors import NotFoundError
from .types import (
    ProxyAuditEvent,
    SecretInfo,
    SecretSandboxBinding,
    to_proxy_audit_event,
    to_secret_info,
    to_secret_sandbox_binding,
)


def _secret_create_body(
    name: str,
    value: str,
    provider: Optional[str],
    auth: Optional[dict[str, Any]],
    hosts: Optional[builtins.list[str]],
) -> dict[str, Any]:
    body: dict[str, Any] = {"name": name, "value": value}
    if provider is not None:
        body["provider"] = provider
    if auth is not None:
        body["auth"] = auth
    if hosts is not None:
        body["hosts"] = hosts
    return body


class Secret:
    """A team-stored credential. Use :meth:`create` / :meth:`get`."""

    def __init__(self, info: SecretInfo, config: ResolvedConfig) -> None:
        self.id = info.id
        self.name = info.name
        self.auth_type = info.auth_type
        self.auth_config = info.auth_config
        self.provider_shortcut = info.provider_shortcut
        self.hosts = info.hosts
        self.created_at = info.created_at
        self.updated_at = info.updated_at
        self.last_used_at = info.last_used_at
        self._config = config

    # -- static factories ---------------------------------------------------

    @classmethod
    def create(
        cls,
        *,
        name: str,
        value: str,
        provider: Optional[str] = None,
        auth: Optional[dict[str, Any]] = None,
        hosts: Optional[builtins.list[str]] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> Secret:
        """Create a secret.

        Provide either a ``provider`` shortcut, or a custom ``auth`` config
        together with ``hosts``.
        """
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "POST",
            f"{config.base_url}/secrets",
            headers={"X-API-Key": config.api_key},
            json_body=_secret_create_body(name, value, provider, auth, hosts),
        )
        return cls(to_secret_info(raw), config)

    @classmethod
    def get(
        cls,
        name: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> Secret:
        """Fetch an existing secret by name."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "GET",
            f"{config.base_url}/secrets/{quote(name, safe='')}",
            headers={"X-API-Key": config.api_key},
        )
        return cls(to_secret_info(raw), config)

    @classmethod
    def list(
        cls,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> builtins.list[SecretInfo]:
        """List all secrets for the team."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "GET",
            f"{config.base_url}/secrets",
            headers={"X-API-Key": config.api_key},
        )
        return [to_secret_info(s) for s in raw]

    @classmethod
    def delete_by_name(
        cls,
        name: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        """Delete a secret by name. Idempotent."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        try:
            api_request(
                "DELETE",
                f"{config.base_url}/secrets/{quote(name, safe='')}",
                headers={"X-API-Key": config.api_key},
            )
        except NotFoundError:
            pass

    # -- instance methods ---------------------------------------------------

    def get_info(self) -> SecretInfo:
        """Re-fetch the latest metadata for this secret."""
        raw = api_request(
            "GET",
            f"{self._config.base_url}/secrets/{quote(self.name, safe='')}",
            headers={"X-API-Key": self._config.api_key},
        )
        return to_secret_info(raw)

    def rotate(self, value: str) -> Secret:
        """Replace the secret's value. Bound sandboxes keep their env var; the
        new value is injected on subsequent egress. Returns the updated secret.
        """
        raw = api_request(
            "PATCH",
            f"{self._config.base_url}/secrets/{quote(self.name, safe='')}",
            headers={"X-API-Key": self._config.api_key},
            json_body={"value": value},
        )
        return Secret(to_secret_info(raw), self._config)

    def delete(self) -> None:
        """Delete this secret. Idempotent."""
        try:
            api_request(
                "DELETE",
                f"{self._config.base_url}/secrets/{quote(self.name, safe='')}",
                headers={"X-API-Key": self._config.api_key},
            )
        except NotFoundError:
            pass

    def get_audit(
        self,
        *,
        limit: Optional[int] = None,
        before: Optional[int] = None,
        status: Optional[str] = None,
    ) -> builtins.list[ProxyAuditEvent]:
        """Requests made with this secret attached, across all sandboxes."""
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = limit
        if before is not None:
            params["before"] = before
        if status:
            params["status"] = status
        url = f"{self._config.base_url}/secrets/{quote(self.name, safe='')}/audit"
        if params:
            url += "?" + urlencode(params)
        raw = api_request("GET", url, headers={"X-API-Key": self._config.api_key})
        return [to_proxy_audit_event(e) for e in raw]

    def get_sandboxes(self) -> builtins.list[SecretSandboxBinding]:
        """Sandboxes this secret is currently bound to."""
        raw = api_request(
            "GET",
            f"{self._config.base_url}/secrets/{quote(self.name, safe='')}/sandboxes",
            headers={"X-API-Key": self._config.api_key},
        )
        return [to_secret_sandbox_binding(b) for b in raw]
