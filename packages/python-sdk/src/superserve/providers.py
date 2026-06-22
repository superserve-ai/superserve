"""Provider catalog — built-in shortcuts for creating secrets.

Each shortcut preconfigures the auth scheme, allowed hosts, and proxy-token
shape for a well-known service, so ``Secret.create(provider=...)`` needs only a
name and value.

```python
from superserve import Provider, Secret

for p in Provider.list():
    print(p.name, p.hosts)

Secret.create(name="openai-prod", value=key, provider="openai")
```
"""

from __future__ import annotations

import builtins
from typing import Optional

from ._config import resolve_config
from ._http import api_request, async_api_request
from .types import ProviderShortcut, to_provider_shortcut


class Provider:
    """Read-only access to the built-in provider catalog."""

    @classmethod
    def list(
        cls,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> builtins.list[ProviderShortcut]:
        """List the built-in provider shortcuts, in catalog order."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "GET",
            f"{config.base_url}/providers",
            headers={"X-API-Key": config.api_key},
        )
        return [to_provider_shortcut(p) for p in raw]


class AsyncProvider:
    """Async variant of :class:`Provider`."""

    @classmethod
    async def list(
        cls,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> builtins.list[ProviderShortcut]:
        """List the built-in provider shortcuts, in catalog order."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/providers",
            headers={"X-API-Key": config.api_key},
        )
        return [to_provider_shortcut(p) for p in raw]
