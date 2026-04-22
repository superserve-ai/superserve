"""Core types for the Superserve Python SDK."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

from .errors import SandboxError


class SandboxStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    RESUMING = "resuming"


class NetworkConfig(BaseModel):
    allow_out: Optional[list[str]] = None
    deny_out: Optional[list[str]] = None


class SandboxInfo(BaseModel):
    id: str
    name: str
    status: SandboxStatus
    vcpu_count: int = 0
    memory_mib: int = 0
    created_at: datetime
    timeout_seconds: Optional[int] = None
    network: Optional[NetworkConfig] = None
    metadata: dict[str, str] = Field(default_factory=dict)


class CommandResult(BaseModel):
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0


def _parse_iso8601(value: str) -> datetime:
    # datetime.fromisoformat rejects the RFC 3339 `Z` UTC designator on Python < 3.11.
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def to_sandbox_info(raw: dict[str, Any]) -> SandboxInfo:
    """Convert an API response dict to a SandboxInfo model."""
    if not raw.get("id"):
        raise SandboxError("Invalid API response: missing sandbox id")
    if not raw.get("status"):
        raise SandboxError("Invalid API response: missing sandbox status")
    if not raw.get("created_at"):
        raise SandboxError("Invalid API response: missing created_at")

    network = None
    if raw.get("network"):
        network = NetworkConfig(
            allow_out=raw["network"].get("allow_out"),
            deny_out=raw["network"].get("deny_out"),
        )

    return SandboxInfo(
        id=raw["id"],
        name=raw.get("name", ""),
        status=SandboxStatus(raw["status"]),
        vcpu_count=raw.get("vcpu_count", 0),
        memory_mib=raw.get("memory_mib", 0),
        created_at=_parse_iso8601(raw["created_at"]),
        timeout_seconds=raw.get("timeout_seconds"),
        network=network,
        metadata=raw.get("metadata", {}),
    )
