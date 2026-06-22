"""AsyncSecret — async variant of :class:`superserve.Secret`.

```python
from superserve import AsyncSecret, AsyncSandbox

await AsyncSecret.create(name="anthropic-prod", value=key, provider="anthropic")
sandbox = await AsyncSandbox.create(
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
from ._http import async_api_request
from .errors import NotFoundError
from .secrets import _secret_create_body
from .types import (
    ProxyAuditEvent,
    SecretInfo,
    SecretSandboxBinding,
    to_proxy_audit_event,
    to_secret_info,
    to_secret_sandbox_binding,
)


class AsyncSecret:
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
    async def create(
        cls,
        *,
        name: str,
        value: str,
        provider: Optional[str] = None,
        auth: Optional[dict[str, Any]] = None,
        hosts: Optional[builtins.list[str]] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> AsyncSecret:
        """Create a secret.

        Provide either a ``provider`` shortcut, or a custom ``auth`` config
        together with ``hosts``.
        """
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = await async_api_request(
            "POST",
            f"{config.base_url}/secrets",
            headers={"X-API-Key": config.api_key},
            json_body=_secret_create_body(name, value, provider, auth, hosts),
        )
        return cls(to_secret_info(raw), config)

    @classmethod
    async def get(
        cls,
        name: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> AsyncSecret:
        """Fetch an existing secret by name."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/secrets/{quote(name, safe='')}",
            headers={"X-API-Key": config.api_key},
        )
        return cls(to_secret_info(raw), config)

    @classmethod
    async def list(
        cls,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> builtins.list[SecretInfo]:
        """List all secrets for the team."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/secrets",
            headers={"X-API-Key": config.api_key},
        )
        return [to_secret_info(s) for s in raw]

    @classmethod
    async def delete_by_name(
        cls,
        name: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        """Delete a secret by name. Idempotent."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        try:
            await async_api_request(
                "DELETE",
                f"{config.base_url}/secrets/{quote(name, safe='')}",
                headers={"X-API-Key": config.api_key},
            )
        except NotFoundError:
            pass

    # -- instance methods ---------------------------------------------------

    async def get_info(self) -> SecretInfo:
        """Re-fetch the latest metadata for this secret."""
        raw = await async_api_request(
            "GET",
            f"{self._config.base_url}/secrets/{quote(self.name, safe='')}",
            headers={"X-API-Key": self._config.api_key},
        )
        return to_secret_info(raw)

    async def rotate(self, value: str) -> AsyncSecret:
        """Replace the secret's value. Bound sandboxes keep their env var; the
        new value is injected on subsequent egress. Returns the updated secret.
        """
        raw = await async_api_request(
            "PATCH",
            f"{self._config.base_url}/secrets/{quote(self.name, safe='')}",
            headers={"X-API-Key": self._config.api_key},
            json_body={"value": value},
        )
        return AsyncSecret(to_secret_info(raw), self._config)

    async def delete(self) -> None:
        """Delete this secret. Idempotent."""
        try:
            await async_api_request(
                "DELETE",
                f"{self._config.base_url}/secrets/{quote(self.name, safe='')}",
                headers={"X-API-Key": self._config.api_key},
            )
        except NotFoundError:
            pass

    async def get_audit(
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
        raw = await async_api_request(
            "GET", url, headers={"X-API-Key": self._config.api_key}
        )
        return [to_proxy_audit_event(e) for e in raw]

    async def get_sandboxes(self) -> builtins.list[SecretSandboxBinding]:
        """Sandboxes this secret is currently bound to."""
        raw = await async_api_request(
            "GET",
            f"{self._config.base_url}/secrets/{quote(self.name, safe='')}/sandboxes",
            headers={"X-API-Key": self._config.api_key},
        )
        return [to_secret_sandbox_binding(b) for b in raw]
