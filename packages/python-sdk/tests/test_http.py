"""Tests for the internal HttpClient — headers, URL construction, error handling."""

from __future__ import annotations

import httpx
import pytest
from superserve._http import HttpClient
from superserve.errors import APIError

from .conftest import make_http_client


class TestRequestHeaders:
    def test_sends_api_key_header(self):
        captured: dict[str, str] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["x-api-key"] = request.headers.get("x-api-key", "")
            return httpx.Response(200, json={"ok": True})

        http = make_http_client(handler, api_key="sk-test-1234")
        http.request("GET", "/vms")
        assert captured["x-api-key"] == "sk-test-1234"
        http.close()

    def test_sends_content_type_json(self):
        captured: dict[str, str] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["content-type"] = request.headers.get("content-type", "")
            return httpx.Response(200, json={"ok": True})

        http = make_http_client(handler)
        http.request("GET", "/vms")
        assert "application/json" in captured["content-type"]
        http.close()


class TestUrlConstruction:
    def test_prepends_base_url_and_v1(self):
        captured: dict[str, str] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            return httpx.Response(200, json={})

        http = make_http_client(handler)
        http.request("GET", "/vms")
        assert captured["url"] == "https://api.superserve.ai/v1/vms"
        http.close()

    def test_custom_base_url(self):
        captured: dict[str, str] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            return httpx.Response(200, json={})

        transport = httpx.MockTransport(handler)
        http = HttpClient("key", "https://custom.host:9090/")
        http._client = httpx.Client(
            headers={"X-API-Key": "key"}, transport=transport
        )
        http.request("GET", "/vms")
        # Trailing slash on base_url should be stripped.
        assert captured["url"] == "https://custom.host:9090/v1/vms"
        http.close()


class TestErrorParsing:
    def test_json_error_response_raises_api_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                404,
                json={"error": {"code": "not_found", "message": "VM not found"}},
            )

        http = make_http_client(handler)
        with pytest.raises(APIError) as exc_info:
            http.request("GET", "/vms/vm_missing")

        err = exc_info.value
        assert err.status_code == 404
        assert err.code == "not_found"
        assert err.message == "VM not found"
        http.close()

    def test_non_json_error_response_falls_back(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(502, text="Bad Gateway")

        http = make_http_client(handler)
        with pytest.raises(APIError) as exc_info:
            http.request("GET", "/vms")

        err = exc_info.value
        assert err.status_code == 502
        assert err.code == "unknown"
        http.close()

    def test_malformed_json_error_falls_back(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                500,
                json={"unexpected": "shape"},
            )

        http = make_http_client(handler)
        with pytest.raises(APIError) as exc_info:
            http.request("GET", "/vms")

        err = exc_info.value
        assert err.status_code == 500
        # Falls back because "error" key is empty dict
        assert err.code == "unknown"
        http.close()

    def test_success_does_not_raise(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"id": "vm_123"})

        http = make_http_client(handler)
        resp = http.request("GET", "/vms/vm_123")
        assert resp.status_code == 200
        http.close()
