"""Persistent volumes through the native provider-neutral HTTP API."""

from __future__ import annotations

import builtins
import math
import re
from typing import TYPE_CHECKING, Any
from urllib.parse import quote
from uuid import uuid4

from ._config import ResolvedConfig, resolve_config
from ._http import api_request
from .errors import NotFoundError, SandboxError, ValidationError
from .types import VolumeAttachment, VolumeInfo

if TYPE_CHECKING:
    from .async_sandbox import AsyncSandbox
    from .sandbox import Sandbox


_VOLUME_SANDBOX_ID = re.compile(
    r"(?:sb-([A-Za-z0-9]+)-)?"
    r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
)


def _same_volume_sandbox(a: str, b: str) -> bool:
    """Match bare/native UUIDs without discarding conflicting region tags."""
    left, right = _VOLUME_SANDBOX_ID.fullmatch(a), _VOLUME_SANDBOX_ID.fullmatch(b)
    if left is None or right is None:
        return a == b
    return left[2].lower() == right[2].lower() and (
        left[1] is None or right[1] is None or left[1] == right[1]
    )


def _assert_volume_connection(a: ResolvedConfig, b: ResolvedConfig) -> None:
    if (a.api_key, a.base_url.rstrip("/")) != (b.api_key, b.base_url.rstrip("/")):
        raise ValidationError("Volume and sandbox must use the same API connection")


def _volume_timeout(timeout: float) -> float:
    if isinstance(timeout, bool) or not math.isfinite(timeout) or timeout <= 0:
        raise ValidationError("timeout must be a positive finite number")
    return timeout


def _volume_create_body(
    name: str, capacity_bytes: int | None, idempotency_key: str | None
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": name,
        "idempotency_key": idempotency_key
        if idempotency_key is not None
        else str(uuid4()),
    }
    if capacity_bytes is not None:
        body["capacity_bytes"] = capacity_bytes
    return body


def _attachment_body(
    volume_id: str, mount_path: str, read_only: bool | None, idempotency_key: str | None
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "volume_id": volume_id,
        "mount_path": mount_path,
        "idempotency_key": idempotency_key
        if idempotency_key is not None
        else str(uuid4()),
    }
    if read_only is not None:
        body["read_only"] = read_only
    return body


def _mounted_attachment(
    raw: dict[str, Any],
    volume_id: str,
    sandbox_id: str,
    mount_path: str,
    read_only: bool | None,
) -> VolumeAttachment:
    attachment = VolumeAttachment.model_validate(raw)
    if (
        attachment.status != "mounted"
        or attachment.volume_id != volume_id
        or not _same_volume_sandbox(attachment.sandbox_id, sandbox_id)
        or attachment.mount_path != mount_path
        or attachment.read_only != (read_only if read_only is not None else False)
    ):
        raise SandboxError("Volume attach response did not confirm the requested mount")
    return attachment


class _VolumeHandle:
    def __init__(self, info: VolumeInfo, config: ResolvedConfig) -> None:
        self.id = info.id
        self.name = info.name
        self.capacity_bytes = info.capacity_bytes
        self.used_bytes = info.used_bytes
        self.region = info.region
        self.status = info.status
        self.generation = info.generation
        self.error_code = info.error_code
        self.created_at = info.created_at
        self.updated_at = info.updated_at
        self._config = config


class Volume(_VolumeHandle):
    """Persistent storage. Create/attach never run commands inside the sandbox."""

    @classmethod
    def create(
        cls,
        *,
        name: str,
        capacity_bytes: int | None = None,
        idempotency_key: str | None = None,
        timeout: float = 180.0,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> Volume:
        """Create a volume. Supply a stable key to retry an uncertain response."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        timeout = _volume_timeout(timeout)
        raw = api_request(
            "POST",
            f"{config.base_url}/volumes",
            headers={"X-API-Key": config.api_key},
            json_body=_volume_create_body(name, capacity_bytes, idempotency_key),
            timeout=timeout,
            budget=timeout,
        )
        return cls(VolumeInfo.model_validate(raw), config)

    @classmethod
    def connect(
        cls,
        name_or_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
    ) -> Volume:
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "GET",
            f"{config.base_url}/volumes/{quote(name_or_id, safe='')}",
            headers={"X-API-Key": config.api_key},
            timeout=timeout,
            budget=timeout,
        )
        return cls(VolumeInfo.model_validate(raw), config)

    @classmethod
    def list(
        cls,
        *,
        limit: int | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
    ) -> builtins.list[VolumeInfo]:
        if limit is not None and (
            isinstance(limit, bool)
            or not isinstance(limit, int)
            or not 1 <= limit <= 100
        ):
            raise ValidationError("limit must be an integer between 1 and 100")
        config = resolve_config(api_key=api_key, base_url=base_url)
        query = "" if limit is None else f"?limit={limit}"
        raw = api_request(
            "GET",
            f"{config.base_url}/volumes{query}",
            headers={"X-API-Key": config.api_key},
            timeout=timeout,
            budget=timeout,
        )
        return [VolumeInfo.model_validate(value) for value in raw]

    @classmethod
    def delete_by_id(
        cls,
        name_or_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        config = resolve_config(api_key=api_key, base_url=base_url)
        try:
            api_request(
                "DELETE",
                f"{config.base_url}/volumes/{quote(name_or_id, safe='')}",
                headers={"X-API-Key": config.api_key},
                timeout=timeout,
                budget=timeout,
            )
        except NotFoundError:
            pass

    def get_info(self, *, timeout: float = 30.0) -> VolumeInfo:
        raw = api_request(
            "GET",
            f"{self._config.base_url}/volumes/{quote(self.id, safe='')}",
            headers={"X-API-Key": self._config.api_key},
            timeout=timeout,
            budget=timeout,
        )
        return VolumeInfo.model_validate(raw)

    def delete(self, *, timeout: float = 30.0) -> None:
        self.delete_by_id(
            self.id,
            api_key=self._config.api_key,
            base_url=self._config.base_url,
            timeout=timeout,
        )

    def attach(
        self,
        sandbox: str | Sandbox | AsyncSandbox,
        *,
        mount_path: str,
        read_only: bool | None = None,
        idempotency_key: str | None = None,
        timeout: float = 180.0,
    ) -> VolumeAttachment:
        if not isinstance(sandbox, str):
            _assert_volume_connection(self._config, sandbox._config)
        sandbox_id = sandbox if isinstance(sandbox, str) else sandbox.id
        timeout = _volume_timeout(timeout)
        raw = api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{quote(sandbox_id, safe='')}/volumes",
            headers={"X-API-Key": self._config.api_key},
            json_body=_attachment_body(self.id, mount_path, read_only, idempotency_key),
            timeout=timeout,
            budget=timeout,
        )
        return _mounted_attachment(raw, self.id, sandbox_id, mount_path, read_only)

    def list_attachments(
        self, *, timeout: float = 30.0
    ) -> builtins.list[VolumeAttachment]:
        raw = api_request(
            "GET",
            f"{self._config.base_url}/volumes/{quote(self.id, safe='')}/attachments",
            headers={"X-API-Key": self._config.api_key},
            timeout=timeout,
            budget=timeout,
        )
        return [VolumeAttachment.model_validate(value) for value in raw]

    def get_attachment(
        self, attachment_id: str, *, timeout: float = 30.0
    ) -> VolumeAttachment:
        info = _get_volume_attachment(self._config, attachment_id, timeout)
        if info.volume_id != self.id:
            raise ValidationError("Attachment belongs to a different volume")
        return info

    def detach(self, attachment_id: str, *, timeout: float = 30.0) -> None:
        try:
            self.get_attachment(attachment_id, timeout=timeout)
        except NotFoundError:
            return
        _detach_volume_attachment(self._config, attachment_id, timeout)


def _get_volume_attachment(
    config: ResolvedConfig, attachment_id: str, timeout: float = 30.0
) -> VolumeAttachment:
    raw = api_request(
        "GET",
        f"{config.base_url}/volume-attachments/{quote(attachment_id, safe='')}",
        headers={"X-API-Key": config.api_key},
        timeout=timeout,
        budget=timeout,
    )
    return VolumeAttachment.model_validate(raw)


def _detach_volume_attachment(
    config: ResolvedConfig, attachment_id: str, timeout: float = 30.0
) -> None:
    try:
        api_request(
            "DELETE",
            f"{config.base_url}/volume-attachments/{quote(attachment_id, safe='')}",
            headers={"X-API-Key": config.api_key},
            timeout=timeout,
            budget=timeout,
        )
    except NotFoundError:
        pass
