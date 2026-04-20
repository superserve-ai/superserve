"""Tests for config resolution."""

from __future__ import annotations

import pytest
from superserve._config import (
    DEFAULT_BASE_URL,
    DEFAULT_SANDBOX_HOST,
    _derive_sandbox_host,
    data_plane_url,
    resolve_config,
)
from superserve.errors import AuthenticationError


class TestResolveConfig:
    def test_explicit_api_key_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_env")
        cfg = resolve_config(api_key="ss_live_arg")
        assert cfg.api_key == "ss_live_arg"

    def test_env_var_used_when_no_arg(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_env")
        cfg = resolve_config()
        assert cfg.api_key == "ss_live_env"

    def test_missing_raises_authentication_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("SUPERSERVE_API_KEY", raising=False)
        with pytest.raises(AuthenticationError):
            resolve_config()

    def test_explicit_base_url_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_env")
        monkeypatch.setenv("SUPERSERVE_BASE_URL", "https://env.example.com")
        cfg = resolve_config(base_url="https://arg.example.com")
        assert cfg.base_url == "https://arg.example.com"

    def test_env_base_url_used_when_no_arg(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_env")
        monkeypatch.setenv("SUPERSERVE_BASE_URL", "https://env.example.com")
        cfg = resolve_config()
        assert cfg.base_url == "https://env.example.com"

    def test_default_base_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_env")
        monkeypatch.delenv("SUPERSERVE_BASE_URL", raising=False)
        cfg = resolve_config()
        assert cfg.base_url == DEFAULT_BASE_URL


class TestDeriveSandboxHost:
    def test_production(self) -> None:
        assert _derive_sandbox_host("https://api.superserve.ai") == DEFAULT_SANDBOX_HOST

    def test_staging(self) -> None:
        assert (
            _derive_sandbox_host("https://api-staging.superserve.ai")
            == "sandbox-staging.superserve.ai"
        )

    def test_other(self) -> None:
        assert (
            _derive_sandbox_host("https://custom.example.com") == DEFAULT_SANDBOX_HOST
        )

    def test_malformed_url(self) -> None:
        # Should fall back to default
        assert _derive_sandbox_host("not a url") == DEFAULT_SANDBOX_HOST


class TestDataPlaneUrl:
    def test_builds_url(self) -> None:
        assert (
            data_plane_url("abc-123", "sandbox.superserve.ai")
            == "https://boxd-abc-123.sandbox.superserve.ai"
        )
