"""Snapshot — a saved copy of a sandbox's memory and disk.

A snapshot is taken on request and kept until deleted, whatever becomes of the
sandbox it came from. A sandbox created from it continues with the processes
that were running, on the same template and in the same region.

```python
from superserve import Sandbox

snapshot = sandbox.snapshot(name="before-upgrade")
fork = Sandbox.create(name="fork", from_snapshot=snapshot)
```
"""

from __future__ import annotations

import builtins
import time
import uuid
from typing import Any, Optional
from urllib.parse import urlencode

from ._config import ResolvedConfig, resolve_config
from ._http import DeadlineExceeded, api_request
from .errors import NotFoundError, SandboxError, SandboxTimeoutError
from .types import SnapshotInfo, SnapshotStatus, to_snapshot_info

# How long taking a snapshot and waiting for it to settle takes at most, by default.
DEFAULT_SNAPSHOT_TIMEOUT = 15 * 60.0
DEFAULT_SNAPSHOT_POLL_S = 2.0


def _snapshot_create_body(
    kind: str, name: Optional[str], idempotency_key: Optional[str]
) -> dict[str, Any]:
    # Always keyed, so a retried request returns the first one's snapshot.
    body: dict[str, Any] = {
        "kind": kind,
        "idempotency_key": idempotency_key or str(uuid.uuid4()),
    }
    if name is not None:
        body["name"] = name
    return body


def _list_url(
    base_url: str, sandbox_id: str, limit: Optional[int], offset: Optional[int]
) -> str:
    params: dict[str, int] = {}
    if limit is not None:
        params["limit"] = limit
    if offset is not None:
        params["offset"] = offset
    url = f"{base_url}/sandboxes/{sandbox_id}/snapshots"
    return f"{url}?{urlencode(params)}" if params else url


def _is_settled(snapshot_id: str, status: SnapshotStatus) -> bool:
    """True once ready; raises when the snapshot will never be."""
    if status == SnapshotStatus.FAILED:
        raise SandboxError(f"Snapshot {snapshot_id} failed")
    if status == SnapshotStatus.DELETING:
        raise SandboxError(f"Snapshot {snapshot_id} was deleted")
    return status == SnapshotStatus.READY


def _still_settling(
    snapshot_id: str, status: SnapshotStatus, timeout: float
) -> SandboxTimeoutError:
    return SandboxTimeoutError(
        f"Snapshot {snapshot_id} still {SnapshotStatus(status).value} after {timeout}s"
    )


def _fetch(config: ResolvedConfig, snapshot_id: str, **kwargs: Any) -> SnapshotInfo:
    raw = api_request(
        "GET",
        f"{config.base_url}/snapshots/{snapshot_id}",
        headers={"X-API-Key": config.api_key},
        **kwargs,
    )
    return to_snapshot_info(raw)


def _delete(config: ResolvedConfig, snapshot_id: str) -> None:
    # A 202 means the host finishes the removal shortly; the snapshot is
    # already gone from every read.
    try:
        api_request(
            "DELETE",
            f"{config.base_url}/snapshots/{snapshot_id}",
            headers={"X-API-Key": config.api_key},
        )
    except NotFoundError:
        pass


class Snapshot:
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
    def get(
        cls,
        snapshot_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> Snapshot:
        """Fetch a snapshot by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        return cls(_fetch(config, snapshot_id), config)

    @classmethod
    def list(
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
        raw = api_request(
            "GET",
            _list_url(config.base_url, sandbox_id, limit, offset),
            headers={"X-API-Key": config.api_key},
        )
        return [to_snapshot_info(s) for s in raw]

    @classmethod
    def delete_by_id(
        cls,
        snapshot_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        """Delete a snapshot by ID. Idempotent."""
        _delete(resolve_config(api_key=api_key, base_url=base_url), snapshot_id)

    # -- instance methods ---------------------------------------------------

    def get_info(self) -> SnapshotInfo:
        """Re-fetch the latest state of this snapshot."""
        return _fetch(self._config, self.id)

    def rename(self, name: str) -> Snapshot:
        """Rename this snapshot. Returns the renamed snapshot."""
        raw = api_request(
            "PATCH",
            f"{self._config.base_url}/snapshots/{self.id}",
            headers={"X-API-Key": self._config.api_key},
            json_body={"name": name},
        )
        return Snapshot(to_snapshot_info(raw), self._config)

    def delete(self) -> None:
        """Delete this snapshot. Sandboxes created from it are unaffected. Idempotent."""
        _delete(self._config, self.id)

    def wait_until_ready(
        self,
        *,
        timeout: float = DEFAULT_SNAPSHOT_TIMEOUT,
        poll_interval_s: float = DEFAULT_SNAPSHOT_POLL_S,
    ) -> Snapshot:
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
            time.sleep(poll_interval_s)
            try:
                info = _fetch(self._config, self.id, budget=deadline - time.monotonic())
            except DeadlineExceeded as exc:
                raise _still_settling(self.id, status, timeout) from exc
            except NotFoundError as exc:
                raise SandboxError(f"Snapshot {self.id} was deleted") from exc
            status = info.status
            if _is_settled(self.id, status):
                return Snapshot(info, self._config)
