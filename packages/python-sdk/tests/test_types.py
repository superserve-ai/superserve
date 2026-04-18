"""Tests for type models and to_sandbox_info."""

from __future__ import annotations

from datetime import datetime

import pytest

from superserve.types import (
    NetworkConfig,
    SandboxInfo,
    SandboxStatus,
    to_sandbox_info,
)


def _valid_raw() -> dict:
    return {
        "id": "sbx-123",
        "name": "my-sandbox",
        "status": "active",
        "vcpu_count": 2,
        "memory_mib": 1024,
        "access_token": "tok-abc",
        "snapshot_id": "snap-1",
        "created_at": "2026-01-01T12:00:00",
        "timeout_seconds": 600,
        "network": {"allow_out": ["1.2.3.4"], "deny_out": []},
        "metadata": {"key": "value"},
    }


class TestToSandboxInfo:
    def test_valid_response_parses(self) -> None:
        info = to_sandbox_info(_valid_raw())
        assert isinstance(info, SandboxInfo)
        assert info.id == "sbx-123"
        assert info.name == "my-sandbox"
        assert info.status == SandboxStatus.ACTIVE
        assert info.vcpu_count == 2
        assert info.memory_mib == 1024
        assert info.access_token == "tok-abc"
        assert info.snapshot_id == "snap-1"
        assert info.timeout_seconds == 600
        assert info.metadata == {"key": "value"}
        assert info.network is not None
        assert info.network.allow_out == ["1.2.3.4"]
        assert info.network.deny_out == []

    def test_missing_id_raises(self) -> None:
        raw = _valid_raw()
        del raw["id"]
        with pytest.raises(ValueError, match="id"):
            to_sandbox_info(raw)

    def test_missing_status_raises(self) -> None:
        raw = _valid_raw()
        del raw["status"]
        with pytest.raises(ValueError, match="status"):
            to_sandbox_info(raw)

    def test_missing_access_token_is_allowed(self) -> None:
        """List responses omit access_token per-item; SandboxInfo reflects that."""
        raw = _valid_raw()
        del raw["access_token"]
        info = to_sandbox_info(raw)
        assert info.id == raw["id"]
        assert info.access_token is None

    def test_missing_optional_fields_uses_defaults(self) -> None:
        raw = {
            "id": "sbx-1",
            "status": "starting",
            "access_token": "tok",
        }
        info = to_sandbox_info(raw)
        assert info.name == ""
        assert info.vcpu_count == 0
        assert info.memory_mib == 0
        assert info.snapshot_id is None
        assert info.timeout_seconds is None
        assert info.network is None
        assert info.metadata == {}

    def test_created_at_parses_datetime(self) -> None:
        raw = _valid_raw()
        info = to_sandbox_info(raw)
        assert isinstance(info.created_at, datetime)
        assert info.created_at.year == 2026
        assert info.created_at.month == 1

    def test_created_at_defaults_when_missing(self) -> None:
        raw = _valid_raw()
        del raw["created_at"]
        info = to_sandbox_info(raw)
        assert isinstance(info.created_at, datetime)

    def test_network_config_parses(self) -> None:
        cfg = NetworkConfig(allow_out=["1.1.1.1"], deny_out=None)
        assert cfg.allow_out == ["1.1.1.1"]
        assert cfg.deny_out is None


class TestSandboxStatus:
    def test_all_statuses_exist(self) -> None:
        assert SandboxStatus.STARTING.value == "starting"
        assert SandboxStatus.ACTIVE.value == "active"
        assert SandboxStatus.PAUSING.value == "pausing"
        assert SandboxStatus.IDLE.value == "idle"
        assert SandboxStatus.FAILED.value == "failed"
        assert SandboxStatus.DELETED.value == "deleted"
