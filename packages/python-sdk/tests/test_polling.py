"""Tests for wait_for_status."""

from __future__ import annotations

import httpx
import pytest
import respx
from superserve._config import ResolvedConfig
from superserve._polling import wait_for_status
from superserve.errors import SandboxError, SandboxTimeoutError
from superserve.types import SandboxStatus


def _config() -> ResolvedConfig:
    return ResolvedConfig(
        api_key="ss_live_key",
        base_url="https://api.example.com",
        sandbox_host="sandbox.example.com",
    )


def _make_raw(status: str) -> dict:
    return {
        "id": "sbx-1",
        "name": "test",
        "status": status,
        "access_token": "tok",
    }


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    import time as _time

    monkeypatch.setattr(_time, "sleep", lambda _s: None)


class TestWaitForStatus:
    def test_returns_when_status_matches(self) -> None:
        with respx.mock() as router:
            router.get("https://api.example.com/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_make_raw("active"))
            )
            info = wait_for_status(
                "sbx-1", SandboxStatus.ACTIVE, _config(), timeout_seconds=5.0
            )
            assert info.id == "sbx-1"
            assert info.status == SandboxStatus.ACTIVE

    def test_polls_multiple_times(self) -> None:
        with respx.mock() as router:
            router.get("https://api.example.com/sandboxes/sbx-1").mock(
                side_effect=[
                    httpx.Response(200, json=_make_raw("starting")),
                    httpx.Response(200, json=_make_raw("starting")),
                    httpx.Response(200, json=_make_raw("active")),
                ]
            )
            info = wait_for_status(
                "sbx-1",
                SandboxStatus.ACTIVE,
                _config(),
                timeout_seconds=10.0,
                interval_seconds=0.001,
            )
            assert info.status == SandboxStatus.ACTIVE

    def test_fails_fast_on_failed_state(self) -> None:
        with respx.mock() as router:
            router.get("https://api.example.com/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_make_raw("failed"))
            )
            with pytest.raises(SandboxError, match="failed"):
                wait_for_status(
                    "sbx-1", SandboxStatus.ACTIVE, _config(), timeout_seconds=5.0
                )

    def test_fails_fast_on_deleted_state(self) -> None:
        with respx.mock() as router:
            router.get("https://api.example.com/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_make_raw("deleted"))
            )
            with pytest.raises(SandboxError, match="deleted"):
                wait_for_status(
                    "sbx-1", SandboxStatus.ACTIVE, _config(), timeout_seconds=5.0
                )

    def test_deleted_allowed_when_target_is_deleted(self) -> None:
        with respx.mock() as router:
            router.get("https://api.example.com/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_make_raw("deleted"))
            )
            info = wait_for_status(
                "sbx-1", SandboxStatus.DELETED, _config(), timeout_seconds=5.0
            )
            assert info.status == SandboxStatus.DELETED

    def test_times_out(self) -> None:
        with respx.mock() as router:
            router.get("https://api.example.com/sandboxes/sbx-1").mock(
                return_value=httpx.Response(200, json=_make_raw("starting"))
            )
            with pytest.raises(SandboxTimeoutError):
                wait_for_status(
                    "sbx-1",
                    SandboxStatus.ACTIVE,
                    _config(),
                    timeout_seconds=0.01,
                    interval_seconds=0.005,
                )
