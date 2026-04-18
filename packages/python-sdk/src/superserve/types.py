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
    FAILED = "failed"
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
    # Per-sandbox data-plane token. Only returned on create/get/connect —
    # may be absent on list responses.
    access_token: Optional[str] = None
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
    """Convert an API response dict to a SandboxInfo model.

    Requires only ``id`` and ``status``. ``access_token`` is optional because
    the list endpoint (``GET /sandboxes``) doesn't return it on each item.
    Call sites that need the token (``Sandbox.create`` / ``connect``)
    validate separately.
    """
    if not raw.get("id"):
        raise ValueError("Invalid API response: missing sandbox id")
    if not raw.get("status"):
        raise ValueError("Invalid API response: missing sandbox status")

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
        access_token=raw.get("access_token"),
        snapshot_id=raw.get("snapshot_id"),
        created_at=datetime.fromisoformat(raw["created_at"])
        if raw.get("created_at")
        else datetime.now(),
        timeout_seconds=raw.get("timeout_seconds"),
        network=network,
        metadata=raw.get("metadata", {}),
    )
