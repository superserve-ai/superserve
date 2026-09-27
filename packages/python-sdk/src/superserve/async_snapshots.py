"""AsyncSnapshot — async variant of :class:`superserve.Snapshot`.

```python
from superserve import AsyncSandbox

snapshot = await sandbox.snapshot(name="before-upgrade")
fork = await AsyncSandbox.create(name="fork", from_snapshot=snapshot)
```
"""

from __future__ import annotations

import asyncio
import builtins
import time
from typing import Any, Optional

from ._config import ResolvedConfig, resolve_config
from ._http import DeadlineExceeded, async_api_request
from .errors import NotFoundError, SandboxError
from .snapshots import (
    DEFAULT_SNAPSHOT_POLL_S,
    DEFAULT_SNAPSHOT_TIMEOUT,
    _is_settled,
    _list_url,
    _still_settling,
)
from .types import SnapshotInfo, SnapshotStatus, to_snapshot_info


async def _fetch(
    config: ResolvedConfig, snapshot_id: str, **kwargs: Any
) -> SnapshotInfo:
    raw = await async_api_request(
        "GET",
        f"{config.base_url}/snapshots/{snapshot_id}",
        headers={"X-API-Key": config.api_key},
        **kwargs,
    )
    return to_snapshot_info(raw)


async def _delete(config: ResolvedConfig, snapshot_id: str) -> None:
    # A 202 means the host finishes the removal shortly; the snapshot is
    # already gone from every read.
    try:
        await async_api_request(
            "DELETE",
            f"{config.base_url}/snapshots/{snapshot_id}",
            headers={"X-API-Key": config.api_key},
        )
    except NotFoundError:
        pass


class AsyncSnapshot:
    """A saved sandbox. Use ``sandbox.snapshot()`` or :meth:`get`."""

    def __init__(self, info: SnapshotInfo, config: ResolvedConfig) -> None:
        self.id = info.id
        self.sandbox_id = info.sandbox_id
        self.template_id = info.template_id
        self.kind = info.kind
        # Status when this instance was fetched; call get_info() for the current one.
        self.status = info.status
        self.name = info.name
        self.size_bytes = info.size_bytes
        self.resources = info.resources
        self.created_at = info.created_at
        self.ready_at = info.ready_at
        self._config = config

    # -- static factories ---------------------------------------------------

    @classmethod
    async def get(
        cls,
        snapshot_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> AsyncSnapshot:
        """Fetch a snapshot by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        return cls(await _fetch(config, snapshot_id), config)

    @classmethod
    async def list(
        cls,
        sandbox_id: str,
        *,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> builtins.list[SnapshotInfo]:
        """List a sandbox's snapshots, newest first. Works for a deleted sandbox too."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = await async_api_request(
            "GET",
            _list_url(config.base_url, sandbox_id, limit, offset),
            headers={"X-API-Key": config.api_key},
        )
        return [to_snapshot_info(s) for s in raw]

    @classmethod
    async def delete_by_id(
        cls,
        snapshot_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        """Delete a snapshot by ID. Idempotent."""
        await _delete(resolve_config(api_key=api_key, base_url=base_url), snapshot_id)

    # -- instance methods ---------------------------------------------------

    async def get_info(self) -> SnapshotInfo:
        """Re-fetch the latest state of this snapshot."""
        return await _fetch(self._config, self.id)

    async def rename(self, name: str) -> AsyncSnapshot:
        """Rename this snapshot. Returns the renamed snapshot."""
        raw = await async_api_request(
            "PATCH",
            f"{self._config.base_url}/snapshots/{self.id}",
            headers={"X-API-Key": self._config.api_key},
            json_body={"name": name},
        )
        return AsyncSnapshot(to_snapshot_info(raw), self._config)

    async def delete(self) -> None:
        """Delete this snapshot. Sandboxes created from it are unaffected. Idempotent."""
        await _delete(self._config, self.id)

    async def wait_until_ready(
        self,
        *,
        timeout: float = DEFAULT_SNAPSHOT_TIMEOUT,
        poll_interval_s: float = DEFAULT_SNAPSHOT_POLL_S,
    ) -> AsyncSnapshot:
        """Wait until the snapshot is ``ready``. Raises ``SandboxError`` when it
        failed or was deleted, ``SandboxTimeoutError`` when still settling."""
        if _is_settled(self.id, self.status):
            return self
        deadline = time.monotonic() + timeout
        status: SnapshotStatus = self.status
        while True:
            remaining = deadline - time.monotonic()
            if remaining < poll_interval_s:
                raise _still_settling(self.id, status, timeout)
            await asyncio.sleep(poll_interval_s)
            try:
                info = await _fetch(
                    self._config, self.id, budget=deadline - time.monotonic()
                )
            except DeadlineExceeded as exc:
                raise _still_settling(self.id, status, timeout) from exc
            except NotFoundError as exc:
                raise SandboxError(f"Snapshot {self.id} was deleted") from exc
            status = info.status
            if _is_settled(self.id, status):
                return AsyncSnapshot(info, self._config)
