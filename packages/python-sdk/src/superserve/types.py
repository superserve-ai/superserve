"""Core types for the Superserve Python SDK."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SandboxStatus(str, Enum):
    STARTING = "starting"
    ACTIVE = "active"
    PAUSING = "pausing"
    IDLE = "idle"
    DELETED = "deleted"


class NetworkConfig(BaseModel):
    allow_out: Optional[List[str]] = None
    deny_out: Optional[List[str]] = None


class SandboxInfo(BaseModel):
    id: str
    name: str
    status: SandboxStatus
    vcpu_count: int = 0
    memory_mib: int = 0
    access_token: str = ""
    snapshot_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)
    timeout_seconds: Optional[int] = None
    network: Optional[NetworkConfig] = None
    metadata: Dict[str, str] = Field(default_factory=dict)


class CommandResult(BaseModel):
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0


def to_sandbox_info(raw: Dict[str, Any]) -> SandboxInfo:
    """Convert an API response dict to a SandboxInfo model."""
    network = None
    if raw.get("network"):
        network = NetworkConfig(
            allow_out=raw["network"].get("allow_out"),
            deny_out=raw["network"].get("deny_out"),
        )

    return SandboxInfo(
        id=raw.get("id", ""),
        name=raw.get("name", ""),
        status=SandboxStatus(raw.get("status", "starting")),
        vcpu_count=raw.get("vcpu_count", 0),
        memory_mib=raw.get("memory_mib", 0),
        access_token=raw.get("access_token", ""),
        snapshot_id=raw.get("snapshot_id"),
        created_at=datetime.fromisoformat(raw["created_at"])
        if raw.get("created_at")
        else datetime.now(),
        timeout_seconds=raw.get("timeout_seconds"),
        network=network,
        metadata=raw.get("metadata", {}),
    )
