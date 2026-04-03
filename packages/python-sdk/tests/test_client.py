"""Tests for Superserve client methods — vms, files, checkpoints, exec, fork, rollback."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
import pytest

from superserve import Checkpoint, ExecResult, ForkResult, ForkTree, Superserve, Vm
from superserve.errors import APIError

from .conftest import CHECKPOINT_DATA, VM_DATA, make_client


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _json_response(
    data: Any, status_code: int = 200
) -> httpx.Response:
    return httpx.Response(status_code, json=data)


# ---------------------------------------------------------------------------
# VMs namespace
# ---------------------------------------------------------------------------


class TestVmsCreate:
    def test_sends_post_with_body(self):
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["method"] = request.method
            captured["url"] = str(request.url)
            captured["body"] = json.loads(request.content)
            return _json_response(VM_DATA, 201)

        client = make_client(handler)
        vm = client.vms.create("test-vm", "ubuntu-22.04", vcpu_count=2, mem_size_mib=512)

        assert captured["method"] == "POST"
        assert captured["url"].endswith("/v1/vms")
        assert captured["body"]["name"] == "test-vm"
        assert captured["body"]["image"] == "ubuntu-22.04"
        assert captured["body"]["vcpu_count"] == 2
        assert isinstance(vm, Vm)
        assert vm.id == "vm_abc123"
        client.close()

    def test_optional_params_omitted(self):
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return _json_response(VM_DATA, 201)

        client = make_client(handler)
        client.vms.create("test-vm", "ubuntu-22.04")

        assert "vcpu_count" not in captured["body"]
        assert "mem_size_mib" not in captured["body"]
        client.close()


class TestVmsList:
    def test_returns_list_of_vms(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "GET"
            assert "/v1/vms" in str(request.url)
            return _json_response({"vms": [VM_DATA]})

        client = make_client(handler)
        vms = client.vms.list()
        assert len(vms) == 1
        assert isinstance(vms[0], Vm)
        client.close()

    def test_filters_by_status(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert "status=RUNNING" in str(request.url)
            return _json_response({"vms": [VM_DATA]})

        client = make_client(handler)
        client.vms.list(status="RUNNING")
        client.close()


class TestVmsGet:
    def test_returns_single_vm(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "GET"
            assert "/v1/vms/vm_abc123" in str(request.url)
            return _json_response(VM_DATA)

        client = make_client(handler)
        vm = client.vms.get("vm_abc123")
        assert vm.id == "vm_abc123"
        assert vm.name == "test-vm"
        client.close()


class TestVmsDelete:
    def test_sends_delete(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "DELETE"
            assert "/v1/vms/vm_abc123" in str(request.url)
            return httpx.Response(204)

        client = make_client(handler)
        result = client.vms.delete("vm_abc123")
        assert result is None
        client.close()


class TestVmsLifecycle:
    @pytest.mark.parametrize("action", ["stop", "start", "sleep", "wake"])
    def test_lifecycle_action(self, action: str):
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "POST"
            assert f"/v1/vms/vm_abc123/{action}" in str(request.url)
            return _json_response(VM_DATA)

        client = make_client(handler)
        method = getattr(client.vms, action)
        vm = method("vm_abc123")
        assert isinstance(vm, Vm)
        client.close()


# ---------------------------------------------------------------------------
# Exec
# ---------------------------------------------------------------------------


class TestExec:
    def test_exec_returns_result(self):
        exec_data = {"stdout": "hello\n", "stderr": "", "exit_code": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "POST"
            assert "/v1/vms/vm_abc123/exec" in str(request.url)
            body = json.loads(request.content)
            assert body["command"] == "echo hello"
            return _json_response(exec_data)

        client = make_client(handler)
        result = client.exec("vm_abc123", "echo hello")
        assert isinstance(result, ExecResult)
        assert result.stdout == "hello\n"
        assert result.exit_code == 0
        client.close()

    def test_exec_with_timeout(self):
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return _json_response({"stdout": "", "stderr": "", "exit_code": 0})

        client = make_client(handler)
        client.exec("vm_abc123", "sleep 100", timeout_s=30)
        assert captured["body"]["timeout_s"] == 30
        client.close()


# ---------------------------------------------------------------------------
# Files namespace
# ---------------------------------------------------------------------------


class TestFilesUpload:
    def test_sends_put_with_binary_content(self):
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["method"] = request.method
            captured["url"] = str(request.url)
            captured["content"] = request.content
            captured["headers"] = dict(request.headers)
            return httpx.Response(204)

        client = make_client(handler)
        client.files.upload("vm_abc123", "/app/main.py", b"print('hi')", mode="0755")

        assert captured["method"] == "PUT"
        assert "/v1/vms/vm_abc123/files/app/main.py" in captured["url"]
        assert captured["content"] == b"print('hi')"
        assert captured["headers"].get("x-file-mode") == "0755"
        client.close()

    def test_strips_leading_slash_from_path(self):
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            return httpx.Response(204)

        client = make_client(handler)
        client.files.upload("vm_abc123", "///tmp/test.txt", b"data")

        # Leading slashes are stripped
        assert "/files/tmp/test.txt" in captured["url"]
        client.close()


class TestFilesDownload:
    def test_returns_bytes(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "GET"
            assert "/v1/vms/vm_abc123/files/app/main.py" in str(request.url)
            return httpx.Response(200, content=b"print('hi')")

        client = make_client(handler)
        data = client.files.download("vm_abc123", "/app/main.py")
        assert data == b"print('hi')"
        client.close()


# ---------------------------------------------------------------------------
# Checkpoints namespace
# ---------------------------------------------------------------------------


class TestCheckpointsList:
    def test_returns_checkpoint_list(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "GET"
            assert "/v1/vms/vm_abc123/checkpoints" in str(request.url)
            return _json_response({"checkpoints": [CHECKPOINT_DATA]})

        client = make_client(handler)
        cps = client.checkpoints.list("vm_abc123")
        assert len(cps) == 1
        assert isinstance(cps[0], Checkpoint)
        assert cps[0].id == "cp_001"
        client.close()


class TestCheckpointsCreate:
    def test_sends_post_to_checkpoint_endpoint(self):
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            assert "/v1/vms/vm_abc123/checkpoint" in str(request.url)
            return _json_response(CHECKPOINT_DATA, 201)

        client = make_client(handler)
        cp = client.checkpoints.create("vm_abc123", name="baseline")
        assert captured["body"]["name"] == "baseline"
        assert isinstance(cp, Checkpoint)
        client.close()


class TestCheckpointsDelete:
    def test_sends_delete(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "DELETE"
            assert "/v1/vms/vm_abc123/checkpoints/cp_001" in str(request.url)
            return httpx.Response(204)

        client = make_client(handler)
        client.checkpoints.delete("vm_abc123", "cp_001")
        client.close()

    def test_force_param(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert "force=true" in str(request.url)
            return httpx.Response(204)

        client = make_client(handler)
        client.checkpoints.delete("vm_abc123", "cp_001", force=True)
        client.close()


# ---------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------


class TestRollback:
    def test_rollback_by_checkpoint_id(self):
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            assert "/v1/vms/vm_abc123/rollback" in str(request.url)
            return _json_response(VM_DATA)

        client = make_client(handler)
        vm = client.rollback("vm_abc123", checkpoint_id="cp_001")
        assert captured["body"]["checkpoint_id"] == "cp_001"
        assert isinstance(vm, Vm)
        client.close()

    def test_rollback_by_name(self):
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return _json_response(VM_DATA)

        client = make_client(handler)
        client.rollback("vm_abc123", name="baseline")
        assert captured["body"]["name"] == "baseline"
        client.close()

    def test_rollback_by_minutes_ago(self):
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return _json_response(VM_DATA)

        client = make_client(handler)
        client.rollback("vm_abc123", minutes_ago=10, preserve_newer=True)
        assert captured["body"]["minutes_ago"] == 10
        assert captured["body"]["preserve_newer"] is True
        client.close()


# ---------------------------------------------------------------------------
# Fork
# ---------------------------------------------------------------------------


class TestFork:
    def test_fork_returns_fork_result(self):
        fork_data = {
            "source_vm_id": "vm_abc123",
            "checkpoint_id": "cp_auto",
            "vms": [VM_DATA],
        }

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "POST"
            assert "/v1/vms/vm_abc123/fork" in str(request.url)
            body = json.loads(request.content)
            assert body["count"] == 2
            return _json_response(fork_data)

        client = make_client(handler)
        result = client.fork("vm_abc123", 2)
        assert isinstance(result, ForkResult)
        assert result.source_vm_id == "vm_abc123"
        assert len(result.vms) == 1
        client.close()

    def test_fork_with_checkpoint(self):
        fork_data = {
            "source_vm_id": "vm_abc123",
            "checkpoint_id": "cp_001",
            "vms": [VM_DATA],
        }
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return _json_response(fork_data)

        client = make_client(handler)
        client.fork("vm_abc123", from_checkpoint_id="cp_001")
        assert captured["body"]["from_checkpoint_id"] == "cp_001"
        client.close()


class TestForkTree:
    def test_returns_nested_tree(self):
        tree_data = {
            "vm_id": "vm_abc123",
            "name": "root",
            "status": "RUNNING",
            "forked_from_checkpoint_id": None,
            "children": [
                {
                    "vm_id": "vm_fork_01",
                    "name": "fork-1",
                    "status": "RUNNING",
                    "forked_from_checkpoint_id": "cp_003",
                    "children": [],
                }
            ],
        }

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "GET"
            assert "/v1/vms/vm_abc123/tree" in str(request.url)
            return _json_response(tree_data)

        client = make_client(handler)
        tree = client.fork_tree("vm_abc123")
        assert isinstance(tree, ForkTree)
        assert tree.vm_id == "vm_abc123"
        assert len(tree.children) == 1
        assert tree.children[0].forked_from_checkpoint_id == "cp_003"
        client.close()


# ---------------------------------------------------------------------------
# Client lifecycle and env fallback
# ---------------------------------------------------------------------------


class TestClientEnvFallback:
    def test_api_key_from_env(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("SUPERSERVE_API_KEY", "env-key")

        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["headers"] = dict(request.headers)
            return _json_response({"vms": []})

        client = Superserve()
        transport = httpx.MockTransport(handler)
        client._http._client = httpx.Client(
            headers={"X-API-Key": "env-key", "Content-Type": "application/json"},
            transport=transport,
        )
        client.vms.list()
        assert captured["headers"]["x-api-key"] == "env-key"
        client.close()

    def test_base_url_from_env(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("SUPERSERVE_API_URL", "https://custom.example.com")
        client = Superserve(api_key="test-key")
        assert client._http._base_url == "https://custom.example.com"
        client.close()


class TestClientContextManager:
    def test_enter_returns_self(self):
        client = Superserve(api_key="test-key")
        with client as c:
            assert c is client

    def test_exit_closes_client(self):
        client = Superserve(api_key="test-key")
        client.__enter__()
        client.__exit__(None, None, None)
        # After close, the underlying httpx client should be closed.
        assert client._http._client.is_closed
