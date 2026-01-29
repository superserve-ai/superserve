"""Authentication helpers for Platform API."""

from pydantic import ValidationError

from .config import CREDENTIALS_FILE
from .types import Credentials


def save_credentials(creds: Credentials) -> None:
    """Save credentials to config file.

    Args:
        creds: Credentials to save.
    """
    CREDENTIALS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CREDENTIALS_FILE.write_text(creds.model_dump_json())
    # Restrict permissions to owner only
    CREDENTIALS_FILE.chmod(0o600)


def get_credentials() -> Credentials | None:
    """Load credentials from config file.

    Returns:
        Credentials if found and valid, None otherwise.
    """
    if not CREDENTIALS_FILE.exists():
        return None
    try:
        return Credentials.model_validate_json(CREDENTIALS_FILE.read_text())
    except (ValidationError, ValueError):
        return None


def clear_credentials() -> None:
    """Remove stored credentials."""
    if CREDENTIALS_FILE.exists():
        CREDENTIALS_FILE.unlink()


def is_authenticated() -> bool:
    """Check if user has stored credentials.

    Returns:
        True if credentials exist, False otherwise.
    """
    return get_credentials() is not None
