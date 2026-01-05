"""RayAI Platform API client for cloud deployments."""

from .auth import clear_credentials, get_credentials, is_authenticated, save_credentials
from .client import PlatformAPIError, PlatformClient
from .config import CREDENTIALS_FILE, PLATFORM_API_URL
from .packaging import package_deployment
from .types import (
    AgentManifest,
    Credentials,
    DeploymentManifest,
    DeploymentResponse,
    DeviceCodeResponse,
    LogEntry,
)

__all__ = [
    # Auth
    "save_credentials",
    "get_credentials",
    "clear_credentials",
    "is_authenticated",
    # Client
    "PlatformClient",
    "PlatformAPIError",
    # Config
    "PLATFORM_API_URL",
    "CREDENTIALS_FILE",
    # Packaging
    "package_deployment",
    # Types
    "Credentials",
    "AgentManifest",
    "DeploymentManifest",
    "DeploymentResponse",
    "DeviceCodeResponse",
    "LogEntry",
]
