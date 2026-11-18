"""Async provider-neutral persistent volume API."""

from __future__ import annotations

import builtins
from typing import TYPE_CHECKING
from urllib.parse import quote

from ._config import ResolvedConfig, resolve_config
from ._http import async_api_request
from .errors import NotFoundError, ValidationError
from .types import VolumeAttachment, VolumeInfo
from .volume import (
    _VolumeHandle,
    _assert_volume_connection,
    _volume_timeout,
    _volume_create_body,
    _attachment_body,
    _mounted_attachment,
)

if TYPE_CHECKING:
    from .sandbox import Sandbox
    from .async_sandbox import AsyncSandbox


class AsyncVolume(_VolumeHandle):
    """Persistent storage. Create/attach never run commands inside the sandbox."""

    @classmethod
    async def create(
        cls,
        *,
        name: str,
        capacity_bytes: int | None = None,
        idempotency_key: str | None = None,
        timeout: float = 180.0,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> AsyncVolume:
        """Create a volume. Supply a stable key to retry an uncertain response."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        timeout = _volume_timeout(timeout)
        raw = await async_api_request(
            "POST",
            f"{config.base_url}/volumes",
            headers={"X-API-Key": config.api_key},
            json_body=_volume_create_body(name, capacity_bytes, idempotency_key),
            timeout=timeout,
            budget=timeout,
        )
        return cls(VolumeInfo.model_validate(raw), config)

    @classmethod
    async def connect(
        cls,
        name_or_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
    ) -> AsyncVolume:
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/volumes/{quote(name_or_id, safe='')}",
            headers={"X-API-Key": config.api_key},
            timeout=timeout,
            budget=timeout,
        )
        return cls(VolumeInfo.model_validate(raw), config)

    @classmethod
    async def list(
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
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/volumes{query}",
            headers={"X-API-Key": config.api_key},
            timeout=timeout,
            budget=timeout,
        )
        return [VolumeInfo.model_validate(value) for value in raw]

    @classmethod
    async def delete_by_id(
        cls,
        name_or_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        config = resolve_config(api_key=api_key, base_url=base_url)
        try:
            await async_api_request(
                "DELETE",
                f"{config.base_url}/volumes/{quote(name_or_id, safe='')}",
                headers={"X-API-Key": config.api_key},
                timeout=timeout,
                budget=timeout,
            )
        except NotFoundError:
            pass

    async def get_info(self, *, timeout: float = 30.0) -> VolumeInfo:
        raw = await async_api_request(
            "GET",
            f"{self._config.base_url}/volumes/{quote(self.id, safe='')}",
            headers={"X-API-Key": self._config.api_key},
            timeout=timeout,
            budget=timeout,
        )
        return VolumeInfo.model_validate(raw)

    async def delete(self, *, timeout: float = 30.0) -> None:
        await self.delete_by_id(
            self.id,
            api_key=self._config.api_key,
            base_url=self._config.base_url,
            timeout=timeout,
        )

    async def attach(
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
        raw = await async_api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{quote(sandbox_id, safe='')}/volumes",
            headers={"X-API-Key": self._config.api_key},
            json_body=_attachment_body(self.id, mount_path, read_only, idempotency_key),
            timeout=timeout,
            budget=timeout,
        )
        return _mounted_attachment(raw, self.id, sandbox_id, mount_path, read_only)

    async def list_attachments(
        self, *, timeout: float = 30.0
    ) -> builtins.list[VolumeAttachment]:
        raw = await async_api_request(
            "GET",
            f"{self._config.base_url}/volumes/{quote(self.id, safe='')}/attachments",
            headers={"X-API-Key": self._config.api_key},
            timeout=timeout,
            budget=timeout,
        )
        return [VolumeAttachment.model_validate(value) for value in raw]

    async def get_attachment(
        self, attachment_id: str, *, timeout: float = 30.0
    ) -> VolumeAttachment:
        info = await _get_volume_attachment(self._config, attachment_id, timeout)
        if info.volume_id != self.id:
            raise ValidationError("Attachment belongs to a different volume")
        return info

    async def detach(self, attachment_id: str, *, timeout: float = 30.0) -> None:
        try:
            await self.get_attachment(attachment_id, timeout=timeout)
        except NotFoundError:
            return
        await _detach_volume_attachment(self._config, attachment_id, timeout)


async def _get_volume_attachment(
    config: ResolvedConfig, attachment_id: str, timeout: float = 30.0
) -> VolumeAttachment:
    raw = await async_api_request(
        "GET",
        f"{config.base_url}/volume-attachments/{quote(attachment_id, safe='')}",
        headers={"X-API-Key": config.api_key},
        timeout=timeout,
        budget=timeout,
    )
    return VolumeAttachment.model_validate(raw)


async def _detach_volume_attachment(
    config: ResolvedConfig, attachment_id: str, timeout: float = 30.0
) -> None:
    try:
        await async_api_request(
            "DELETE",
            f"{config.base_url}/volume-attachments/{quote(attachment_id, safe='')}",
            headers={"X-API-Key": config.api_key},
            timeout=timeout,
            budget=timeout,
        )
    except NotFoundError:
        pass
