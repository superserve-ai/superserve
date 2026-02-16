"""Tests for superserve.cli.platform module."""

from unittest.mock import patch

import pytest
from pydantic import ValidationError

from superserve.cli.platform.auth import (
    clear_credentials,
    get_credentials,
    is_authenticated,
    save_credentials,
)
from superserve.cli.platform.types import (
    Credentials,
    DeviceCodeResponse,
)


class TestCredentials:
    """Tests for Credentials model."""

    def test_create_credentials(self):
        """Create basic credentials."""
        creds = Credentials(token="test-token-123")
        assert creds.token == "test-token-123"
        assert creds.token_type == "Bearer"
        assert creds.expires_at is None
        assert creds.refresh_token is None

    def test_create_full_credentials(self):
        """Create credentials with all fields."""
        creds = Credentials(
            token="test-token-123",
            token_type="Bearer",
            expires_at="2025-12-31T23:59:59Z",
            refresh_token="refresh-123",
        )
        assert creds.token == "test-token-123"
        assert creds.expires_at == "2025-12-31T23:59:59Z"
        assert creds.refresh_token == "refresh-123"

    def test_credentials_json_serialization(self):
        """Credentials can be serialized to JSON."""
        creds = Credentials(token="test-token")
        json_str = creds.model_dump_json()
        assert "test-token" in json_str

    def test_credentials_from_json(self):
        """Credentials can be parsed from JSON."""
        json_str = '{"token": "parsed-token", "token_type": "Bearer"}'
        creds = Credentials.model_validate_json(json_str)
        assert creds.token == "parsed-token"

    def test_credentials_requires_token(self):
        """Token is required."""
        with pytest.raises(ValidationError):
            Credentials()


class TestDeviceCodeResponse:
    """Tests for DeviceCodeResponse model."""

    def test_create_device_code_response(self):
        """Create device code response."""
        response = DeviceCodeResponse(
            device_code="device-123",
            user_code="ABCD-1234",
            verification_uri="https://superserve.com/auth",
            verification_uri_complete="https://superserve.com/auth?code=ABCD-1234",
            expires_in=900,
            interval=5,
        )
        assert response.device_code == "device-123"
        assert response.user_code == "ABCD-1234"
        assert response.expires_in == 900


class TestAuthModule:
    """Tests for auth module functions."""

    @pytest.fixture
    def temp_credentials_file(self, tmp_path):
        """Provide a temporary credentials file path."""
        creds_file = tmp_path / ".superserve" / "credentials.json"
        with patch("superserve.cli.platform.auth.CREDENTIALS_FILE", creds_file):
            yield creds_file

    def test_save_and_get_credentials(self, temp_credentials_file):
        """Save and retrieve credentials."""
        with patch(
            "superserve.cli.platform.auth.CREDENTIALS_FILE", temp_credentials_file
        ):
            creds = Credentials(token="save-test-token")
            save_credentials(creds)

            loaded = get_credentials()
            assert loaded is not None
            assert loaded.token == "save-test-token"

    def test_get_credentials_not_exists(self, temp_credentials_file):
        """Get credentials when file doesn't exist."""
        with patch(
            "superserve.cli.platform.auth.CREDENTIALS_FILE", temp_credentials_file
        ):
            assert get_credentials() is None

    def test_clear_credentials(self, temp_credentials_file):
        """Clear credentials removes the file."""
        with patch(
            "superserve.cli.platform.auth.CREDENTIALS_FILE", temp_credentials_file
        ):
            creds = Credentials(token="clear-test-token")
            save_credentials(creds)
            assert temp_credentials_file.exists()

            clear_credentials()
            assert not temp_credentials_file.exists()

    def test_is_authenticated(self, temp_credentials_file):
        """Check authentication status."""
        with patch(
            "superserve.cli.platform.auth.CREDENTIALS_FILE", temp_credentials_file
        ):
            assert not is_authenticated()

            save_credentials(Credentials(token="auth-test"))
            assert is_authenticated()

            clear_credentials()
            assert not is_authenticated()

    def test_credentials_file_permissions(self, temp_credentials_file):
        """Credentials file has restricted permissions."""
        with patch(
            "superserve.cli.platform.auth.CREDENTIALS_FILE", temp_credentials_file
        ):
            save_credentials(Credentials(token="perms-test"))
            # Check file mode is 0o600 (owner read/write only)
            mode = temp_credentials_file.stat().st_mode & 0o777
            assert mode == 0o600
