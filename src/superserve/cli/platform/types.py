"""Data types for Platform API contracts."""

from pydantic import BaseModel, Field


class Credentials(BaseModel):
    """Stored authentication credentials."""

    token: str
    token_type: str = "Bearer"
    expires_at: str | None = None
    refresh_token: str | None = None


class DeviceCodeResponse(BaseModel):
    """OAuth device code response."""

    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str
    expires_in: int
    interval: int


# ==================== HOSTED AGENTS ====================


class AgentResponse(BaseModel):
    """Response from agent API."""

    id: str
    name: str
    command: str | None = None
    environment_keys: list[str] = Field(default_factory=list)
    required_secrets: list[str] = Field(default_factory=list)
    deps_status: str = "none"
    deps_error: str | None = None
    created_at: str
    updated_at: str


class RunEvent(BaseModel):
    """SSE event from run stream."""

    type: str
    data: dict
