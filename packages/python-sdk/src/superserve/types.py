"""Core types for the Superserve Python SDK."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class SandboxStatus(str, Enum):
    ACTIVE = "active"
    IDLE = "idle"


class NetworkConfig(BaseModel):
    allow_out: list[str] | None = None
    deny_out: list[str] | None = None


class SandboxInfo(BaseModel):
    id: str
    name: str
    status: SandboxStatus
    vcpu_count: int = 0
    memory_mib: int = 0
    created_at: datetime = Field(default_factory=datetime.now)
    timeout_seconds: int | None = None
    network: NetworkConfig | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class CommandResult(BaseModel):
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0


def to_sandbox_info(raw: dict[str, Any]) -> SandboxInfo:
    """Convert an API response dict to a SandboxInfo model."""
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
        created_at=datetime.fromisoformat(raw["created_at"])
        if raw.get("created_at")
        else datetime.now(),
        timeout_seconds=raw.get("timeout_seconds"),
        network=network,
        metadata=raw.get("metadata", {}),
    )
