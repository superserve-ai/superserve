from __future__ import annotations

from typing import Literal
from agents.sandbox.session.sandbox_client import BaseSandboxClientOptions
from pydantic import Field



class SuperserveSandboxClientOptions(BaseSandboxClientOptions):
    """Client options for Superserve microVM sandbox."""

    type: Literal["superserve"] = "superserve"
    api_key: str | None = Field(default=None, repr=False)
    base_url: str | None = None
    template: str | None = None
    timeout_seconds: int | None = None
    auto_delete_seconds: int | None = None
    metadata: dict[str, str] | None = None
    env_vars: dict[str, str] | None = None

