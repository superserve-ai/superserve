"""Platform API configuration constants."""

import os
from importlib.metadata import version
from pathlib import Path

# Staging:
PLATFORM_API_URL = os.environ.get("RAYAI_API_URL", "https://api-staging.rayai.com")
DASHBOARD_URL = os.environ.get("RAYAI_DASHBOARD_URL", "https://app-staging.rayai.com")
# Local development: uncomment for local testing
# PLATFORM_API_URL = os.environ.get("RAYAI_API_URL", "http://localhost:8000")
# DASHBOARD_URL = os.environ.get("RAYAI_DASHBOARD_URL", "http://localhost:3001")
RAYAI_CONFIG_DIR = Path.home() / ".rayai"
CREDENTIALS_FILE = RAYAI_CONFIG_DIR / "credentials.json"
USER_AGENT = f"rayai-cli/{version('rayai')}"
DEFAULT_TIMEOUT = 30  # seconds
DEVICE_POLL_INTERVAL = 5  # seconds
