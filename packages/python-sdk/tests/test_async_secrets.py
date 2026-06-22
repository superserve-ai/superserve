"""Tests for AsyncSecret, AsyncProvider, and the async network log."""

from __future__ import annotations

import json

import httpx
import pytest
import respx
from superserve import AsyncProvider, AsyncSandbox, AsyncSecret

API = "https://api.example.com"

_SECRET = {
    "id": "sec-1",
    "name": "anthropic-prod",
    "auth_type": "api-key",
    "auth_config": {"header": "x-api-key"},
    "provider_shortcut": "anthropic",
    "hosts": ["api.anthropic.com"],
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-02T00:00:00Z",
}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)


@pytest.mark.asyncio
async def test_async_secret_create_and_rotate() -> None:
    with respx.mock() as router:
        router.post(f"{API}/secrets").mock(
            return_value=httpx.Response(200, json=_SECRET)
        )
        secret = await AsyncSecret.create(
            name="anthropic-prod", value="sk-ant", provider="anthropic"
        )
        assert secret.name == "anthropic-prod"

        route = router.patch(f"{API}/secrets/anthropic-prod").mock(
            return_value=httpx.Response(200, json=_SECRET)
        )
        await secret.rotate("sk-ant-new")
        assert json.loads(route.calls.last.request.content) == {"value": "sk-ant-new"}


@pytest.mark.asyncio
async def test_async_provider_list() -> None:
    with respx.mock() as router:
        router.get(f"{API}/providers").mock(
            return_value=httpx.Response(
                200,
                json=[
                    {
                        "name": "openai",
                        "display": "OpenAI",
                        "auth_type": "bearer",
                        "auth_config": {},
                        "hosts": ["api.openai.com"],
                        "token_shape": "sk-proj-...",
                    }
                ],
            )
        )
        providers = await AsyncProvider.list()
        assert providers[0].name == "openai"


@pytest.mark.asyncio
async def test_async_create_with_secrets_and_network_log() -> None:
    with respx.mock() as router:
        create = router.post(f"{API}/sandboxes").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "sb-1",
                    "name": "agent-1",
                    "status": "active",
                    "created_at": "2026-01-01T00:00:00Z",
                    "access_token": "tok",
                },
            )
        )
        sandbox = await AsyncSandbox.create(
            name="agent-1", secrets={"OPENAI_API_KEY": "openai-prod"}
        )
        body = json.loads(create.calls.last.request.content)
        assert body["secrets"] == {"OPENAI_API_KEY": "openai-prod"}

        router.get(url__regex=rf"{API}/sandboxes/sb-1/network.*").mock(
            return_value=httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "kind": "request",
                            "id": 1,
                            "ts": "2026-01-01T00:00:30Z",
                            "method": "POST",
                            "status": 200,
                        }
                    ],
                    "next_cursor": None,
                    "has_more": False,
                },
            )
        )
        page = await sandbox.get_network_log(verdict="blocked")
        assert page.has_more is False
        assert page.events[0].method == "POST"
