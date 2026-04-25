"""Core types for the Superserve Python SDK."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional, Union

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


# ---------------------------------------------------------------------------
# Template
# ---------------------------------------------------------------------------


class TemplateStatus(str, Enum):
    PENDING = "pending"
    BUILDING = "building"
    READY = "ready"
    FAILED = "failed"


class TemplateBuildStatus(str, Enum):
    PENDING = "pending"
    BUILDING = "building"
    SNAPSHOTTING = "snapshotting"
    READY = "ready"
    FAILED = "failed"
    CANCELLED = "cancelled"


class BuildLogStream(str, Enum):
    STDOUT = "stdout"
    STDERR = "stderr"
    SYSTEM = "system"


class TemplateInfo(BaseModel):
    id: str
    alias: str
    team_id: str
    status: TemplateStatus
    vcpu: int = 0
    memory_mib: int = 0
    disk_mib: int = 0
    size_bytes: Optional[int] = None
    error_message: Optional[str] = None
    created_at: datetime
    built_at: Optional[datetime] = None
    latest_build_id: Optional[str] = None


class TemplateBuildInfo(BaseModel):
    id: str
    template_id: str
    status: TemplateBuildStatus
    build_spec_hash: str
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    finalized_at: Optional[datetime] = None
    created_at: datetime


class BuildLogEvent(BaseModel):
    timestamp: datetime
    stream: BuildLogStream
    text: str = ""
    finished: Optional[bool] = None
    status: Optional[str] = None  # "ready" | "failed" | "cancelled" when finished


# BuildStep discriminated union (mutually exclusive fields)
class RunStep(BaseModel):
    run: str


class EnvStepValue(BaseModel):
    key: str
    value: str


class EnvStep(BaseModel):
    env: EnvStepValue


class WorkdirStep(BaseModel):
    workdir: str


class UserStepValue(BaseModel):
    name: str
    sudo: bool = False


class UserStep(BaseModel):
    user: UserStepValue


BuildStep = Union[RunStep, EnvStep, WorkdirStep, UserStep]


# ---------------------------------------------------------------------------
# Template converters
# ---------------------------------------------------------------------------


def to_template_info(
    raw: dict[str, Any],
    latest_build_id: Optional[str] = None,
) -> TemplateInfo:
    if not raw.get("id"):
        raise SandboxError("Invalid API response: missing template id")
    if not raw.get("alias"):
        raise SandboxError("Invalid API response: missing template alias")
    if not raw.get("status"):
        raise SandboxError("Invalid API response: missing template status")
    if not raw.get("team_id"):
        raise SandboxError("Invalid API response: missing team_id")
    if not raw.get("created_at"):
        raise SandboxError("Invalid API response: missing created_at")

    return TemplateInfo(
        id=raw["id"],
        alias=raw["alias"],
        team_id=raw["team_id"],
        status=TemplateStatus(raw["status"]),
        vcpu=raw.get("vcpu", 0),
        memory_mib=raw.get("memory_mib", 0),
        disk_mib=raw.get("disk_mib", 0),
        size_bytes=raw.get("size_bytes"),
        error_message=raw.get("error_message"),
        created_at=_parse_iso8601(raw["created_at"]),
        built_at=_parse_iso8601(raw["built_at"]) if raw.get("built_at") else None,
        latest_build_id=latest_build_id or raw.get("latest_build_id"),
    )


def to_template_build_info(raw: dict[str, Any]) -> TemplateBuildInfo:
    if not raw.get("id"):
        raise SandboxError("Invalid API response: missing build id")
    if not raw.get("template_id"):
        raise SandboxError("Invalid API response: missing template_id")
    if not raw.get("status"):
        raise SandboxError("Invalid API response: missing build status")
    if not raw.get("build_spec_hash"):
        raise SandboxError("Invalid API response: missing build_spec_hash")
    if not raw.get("created_at"):
        raise SandboxError("Invalid API response: missing created_at")

    return TemplateBuildInfo(
        id=raw["id"],
        template_id=raw["template_id"],
        status=TemplateBuildStatus(raw["status"]),
        build_spec_hash=raw["build_spec_hash"],
        error_message=raw.get("error_message"),
        started_at=_parse_iso8601(raw["started_at"]) if raw.get("started_at") else None,
        finalized_at=_parse_iso8601(raw["finalized_at"]) if raw.get("finalized_at") else None,
        created_at=_parse_iso8601(raw["created_at"]),
    )


def to_build_log_event(raw: dict[str, Any]) -> BuildLogEvent:
    if not raw.get("timestamp"):
        raise SandboxError("Invalid log event: missing timestamp")
    if not raw.get("stream"):
        raise SandboxError("Invalid log event: missing stream")

    return BuildLogEvent(
        timestamp=_parse_iso8601(raw["timestamp"]),
        stream=BuildLogStream(raw["stream"]),
        text=raw.get("text", ""),
        finished=raw.get("finished"),
        status=raw.get("status"),
    )


def build_steps_to_api(steps: list[BuildStep]) -> list[dict[str, Any]]:
    """Serialize BuildStep pydantic models to API dict format."""
    return [s.model_dump() for s in steps]
