"""Tests for Secret, Provider, and the sandbox network log — sync."""

from __future__ import annotations

import json

import httpx
import pytest
import respx
from superserve import (
    NetworkVerdict,
    Provider,
    Sandbox,
    Secret,
    SecretAuthType,
)

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
    "last_used_at": "2026-01-03T00:00:00Z",
}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)


class TestSecretCreate:
    def test_provider_shortcut(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/secrets").mock(
                return_value=httpx.Response(200, json=_SECRET)
            )
            secret = Secret.create(
                name="anthropic-prod", value="sk-ant-real", provider="anthropic"
            )
            assert secret.name == "anthropic-prod"
            assert secret.auth_type == SecretAuthType.API_KEY
            assert secret.provider_shortcut == "anthropic"
            assert secret.hosts == ["api.anthropic.com"]
            body = json.loads(route.calls.last.request.content)
            assert body == {
                "name": "anthropic-prod",
                "value": "sk-ant-real",
                "provider": "anthropic",
            }

    def test_custom_auth_passthrough(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/secrets").mock(
                return_value=httpx.Response(200, json=_SECRET)
            )
            Secret.create(
                name="gh",
                value="ghp_real",
                hosts=["api.github.com", "github.com"],
                auth={
                    "per_host": [
                        {"hosts": ["api.github.com"], "type": "bearer"},
                        {
                            "hosts": ["github.com"],
                            "type": "basic",
                            "username": "x-access-token",
                        },
                    ]
                },
            )
            body = json.loads(route.calls.last.request.content)
            assert body["auth"]["per_host"][1]["username"] == "x-access-token"
            assert body["hosts"] == ["api.github.com", "github.com"]


class TestSecretReads:
    def test_get(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/secrets/anthropic-prod").mock(
                return_value=httpx.Response(200, json=_SECRET)
            )
            secret = Secret.get("anthropic-prod")
            assert secret.id == "sec-1"

    def test_list(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/secrets").mock(
                return_value=httpx.Response(
                    200, json=[_SECRET, {**_SECRET, "id": "sec-2", "name": "openai"}]
                )
            )
            secrets = Secret.list()
            assert [s.name for s in secrets] == ["anthropic-prod", "openai"]

    def test_delete_by_name_swallows_404(self) -> None:
        with respx.mock() as router:
            router.delete(f"{API}/secrets/gone").mock(
                return_value=httpx.Response(
                    404, json={"error": {"code": "not_found", "message": "x"}}
                )
            )
            Secret.delete_by_name("gone")  # does not raise


class TestSecretInstance:
    def _secret(self, router: respx.MockRouter) -> Secret:
        router.post(f"{API}/secrets").mock(
            return_value=httpx.Response(200, json=_SECRET)
        )
        return Secret.create(name="anthropic-prod", value="v", provider="anthropic")

    def test_rotate(self) -> None:
        with respx.mock() as router:
            secret = self._secret(router)
            route = router.patch(f"{API}/secrets/anthropic-prod").mock(
                return_value=httpx.Response(
                    200, json={**_SECRET, "updated_at": "2026-02-01T00:00:00Z"}
                )
            )
            updated = secret.rotate("sk-ant-new")
            assert json.loads(route.calls.last.request.content) == {
                "value": "sk-ant-new"
            }
            assert updated.updated_at.year == 2026

    def test_get_audit_query_and_mapping(self) -> None:
        with respx.mock() as router:
            secret = self._secret(router)
            route = router.get(
                url__regex=rf"{API}/secrets/anthropic-prod/audit.*"
            ).mock(
                return_value=httpx.Response(
                    200,
                    json=[
                        {
                            "id": 5,
                            "ts": "2026-01-04T00:00:00Z",
                            "sandbox_id": "sb-1",
                            "method": "POST",
                            "host": "api.anthropic.com",
                            "path": "/v1/messages",
                            "status": 200,
                        }
                    ],
                )
            )
            events = secret.get_audit(limit=10, before=99, status="4xx")
            q = route.calls.last.request.url.params
            assert q["limit"] == "10"
            assert q["before"] == "99"
            assert q["status"] == "4xx"
            assert events[0].method == "POST"

    def test_get_sandboxes(self) -> None:
        with respx.mock() as router:
            secret = self._secret(router)
            router.get(f"{API}/secrets/anthropic-prod/sandboxes").mock(
                return_value=httpx.Response(
                    200,
                    json=[
                        {
                            "sandbox_id": "sb-1",
                            "sandbox_name": "agent-1",
                            "env_key": "ANTHROPIC_API_KEY",
                            "status": "active",
                        }
                    ],
                )
            )
            bindings = secret.get_sandboxes()
            assert bindings[0].env_key == "ANTHROPIC_API_KEY"


class TestProvider:
    def test_list(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/providers").mock(
                return_value=httpx.Response(
                    200,
                    json=[
                        {
                            "name": "anthropic",
                            "display": "Anthropic",
                            "auth_type": "api-key",
                            "auth_config": {"header": "x-api-key"},
                            "hosts": ["api.anthropic.com"],
                            "token_shape": "sk-ant-api03-...",
                        }
                    ],
                )
            )
            providers = Provider.list()
            assert providers[0].name == "anthropic"
            assert providers[0].token_shape == "sk-ant-api03-..."


class TestSandboxSecretsAndNetwork:
    def _sandbox(
        self, router: respx.MockRouter, **extra: object
    ) -> tuple[Sandbox, dict]:
        route = router.post(f"{API}/sandboxes").mock(
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
        sandbox = Sandbox.create(name="agent-1", **extra)
        body = json.loads(route.calls.last.request.content)
        return sandbox, body

    def test_create_includes_secrets(self) -> None:
        with respx.mock() as router:
            _, body = self._sandbox(
                router, secrets={"ANTHROPIC_API_KEY": "anthropic-prod"}
            )
            assert body["secrets"] == {"ANTHROPIC_API_KEY": "anthropic-prod"}

    def test_get_network_log(self) -> None:
        with respx.mock() as router:
            sandbox, _ = self._sandbox(router)
            route = router.get(url__regex=rf"{API}/sandboxes/sb-1/network.*").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "data": [
                            {
                                "kind": "connection",
                                "id": 2,
                                "ts": "2026-01-01T00:01:00Z",
                                "host": "example.com",
                                "dst_ip": "1.2.3.4",
                                "verdict": "allowed",
                                "bytes_recv": 200,
                            },
                            {
                                "kind": "request",
                                "id": 1,
                                "ts": "2026-01-01T00:00:30Z",
                                "method": "POST",
                                "path": "/v1/messages",
                                "status": 200,
                                "secret_id": "sec-1",
                            },
                        ],
                        "next_cursor": "2026-01-01T00:00:30Z",
                        "has_more": True,
                    },
                )
            )
            page = sandbox.get_network_log(
                limit=2, verdict=NetworkVerdict.ALLOWED, since="2026-01-01T00:00:00Z"
            )
            q = route.calls.last.request.url.params
            assert q["limit"] == "2"
            assert q["verdict"] == "allowed"
            assert q["since"] == "2026-01-01T00:00:00Z"
            assert page.has_more is True
            assert page.next_cursor == "2026-01-01T00:00:30Z"
            assert page.events[0].verdict == NetworkVerdict.ALLOWED
            assert page.events[0].bytes_recv == 200
            assert page.events[1].secret_id == "sec-1"
