"""Superserve Python SDK client."""

from __future__ import annotations

import os
from collections.abc import Generator
from typing import Any

from superserve._http import DEFAULT_BASE_URL, DEFAULT_TIMEOUT, HttpClient
from superserve._sse import parse_sse_stream
from superserve._telemetry import track_event
from superserve.types import Checkpoint, ExecResult, ForkResult, ForkTree, Vm


class _VmsNamespace:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self,
        name: str,
        image: str,
        *,
        vcpu_count: int | None = None,
        mem_size_mib: int | None = None,
    ) -> Vm:
        body: dict[str, Any] = {"name": name, "image": image}
        if vcpu_count is not None:
            body["vcpu_count"] = vcpu_count
        if mem_size_mib is not None:
            body["mem_size_mib"] = mem_size_mib
        resp = self._http.request("POST", "/vms", json=body)
        vm = _parse_vm(resp.json())
        track_event("sdk.vm.create")
        return vm

    def list(self, *, status: str | None = None) -> list[Vm]:
        params: dict[str, str] = {}
        if status:
            params["status"] = status
        resp = self._http.request("GET", "/vms", params=params)
        return [_parse_vm(v) for v in resp.json().get("vms", [])]

    def get(self, vm_id: str) -> Vm:
        resp = self._http.request("GET", f"/vms/{vm_id}")
        return _parse_vm(resp.json())

    def delete(self, vm_id: str) -> None:
        self._http.request("DELETE", f"/vms/{vm_id}")
        track_event("sdk.vm.delete")

    def stop(self, vm_id: str) -> Vm:
        resp = self._http.request("POST", f"/vms/{vm_id}/stop")
        return _parse_vm(resp.json())

    def start(self, vm_id: str) -> Vm:
        resp = self._http.request("POST", f"/vms/{vm_id}/start")
        return _parse_vm(resp.json())

    def sleep(self, vm_id: str) -> Vm:
        resp = self._http.request("POST", f"/vms/{vm_id}/sleep")
        return _parse_vm(resp.json())

    def wake(self, vm_id: str) -> Vm:
        resp = self._http.request("POST", f"/vms/{vm_id}/wake")
        return _parse_vm(resp.json())


class _FilesNamespace:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def upload(
        self,
        vm_id: str,
        remote_path: str,
        data: bytes,
        *,
        mode: str | None = None,
    ) -> None:
        clean_path = remote_path.lstrip("/")
        headers: dict[str, str] = {"Content-Type": "application/octet-stream"}
        if mode:
            headers["X-File-Mode"] = mode
        self._http.request(
            "PUT",
            f"/vms/{vm_id}/files/{clean_path}",
            content=data,
            headers=headers,
        )

    def download(self, vm_id: str, remote_path: str) -> bytes:
        clean_path = remote_path.lstrip("/")
        resp = self._http.request("GET", f"/vms/{vm_id}/files/{clean_path}")
        return resp.content


class _CheckpointsNamespace:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, vm_id: str) -> list[Checkpoint]:
        resp = self._http.request("GET", f"/vms/{vm_id}/checkpoints")
        return [_parse_checkpoint(c) for c in resp.json().get("checkpoints", [])]

    def create(self, vm_id: str, *, name: str) -> Checkpoint:
        resp = self._http.request(
            "POST", f"/vms/{vm_id}/checkpoint", json={"name": name}
        )
        return _parse_checkpoint(resp.json())

    def delete(
        self,
        vm_id: str,
        checkpoint_id: str,
        *,
        force: bool = False,
    ) -> None:
        params: dict[str, str] = {}
        if force:
            params["force"] = "true"
        self._http.request(
            "DELETE",
            f"/vms/{vm_id}/checkpoints/{checkpoint_id}",
            params=params,
        )


class Superserve:
    """Client for the Superserve API.

    Example::

        from superserve import Superserve

        client = Superserve(api_key="your-key")

        vm = client.vms.create(name="test", image="ubuntu-22.04")
        result = client.exec(vm.id, command="echo hello")
        print(result.stdout)

        client.close()
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        resolved_key = api_key or os.environ.get("SUPERSERVE_API_KEY", "")
        resolved_url = (
            base_url
            or os.environ.get("SUPERSERVE_API_URL")
            or DEFAULT_BASE_URL
        )
        self._http = HttpClient(resolved_key, resolved_url, timeout)
        self.vms = _VmsNamespace(self._http)
        self.files = _FilesNamespace(self._http)
        self.checkpoints = _CheckpointsNamespace(self._http)
        track_event("sdk.init")

    # ==================== Exec ====================

    def exec(
        self,
        vm_id: str,
        command: str,
        *,
        timeout_s: int | None = None,
    ) -> ExecResult:
        body: dict[str, Any] = {"command": command}
        if timeout_s is not None:
            body["timeout_s"] = timeout_s
        resp = self._http.request("POST", f"/vms/{vm_id}/exec", json=body)
        data = resp.json()
        track_event("sdk.exec")
        return ExecResult(
            stdout=data["stdout"],
            stderr=data["stderr"],
            exit_code=data["exit_code"],
        )

    def exec_stream(
        self,
        vm_id: str,
        command: str,
        *,
        timeout_s: int | None = None,
    ) -> Generator[dict[str, Any], None, None]:
        body: dict[str, Any] = {"command": command}
        if timeout_s is not None:
            body["timeout_s"] = timeout_s
        resp = self._http.stream(
            "POST", f"/vms/{vm_id}/exec/stream", json=body
        )
        return parse_sse_stream(resp)

    # ==================== Rollback ====================

    def rollback(
        self,
        vm_id: str,
        *,
        checkpoint_id: str | None = None,
        name: str | None = None,
        minutes_ago: int | None = None,
        preserve_newer: bool = False,
    ) -> Vm:
        body: dict[str, Any] = {}
        if checkpoint_id is not None:
            body["checkpoint_id"] = checkpoint_id
        if name is not None:
            body["name"] = name
        if minutes_ago is not None:
            body["minutes_ago"] = minutes_ago
        if preserve_newer:
            body["preserve_newer"] = True
        resp = self._http.request("POST", f"/vms/{vm_id}/rollback", json=body)
        return _parse_vm(resp.json())

    # ==================== Fork ====================

    def fork(
        self,
        vm_id: str,
        count: int = 1,
        *,
        from_checkpoint_id: str | None = None,
    ) -> ForkResult:
        body: dict[str, Any] = {"count": count}
        if from_checkpoint_id is not None:
            body["from_checkpoint_id"] = from_checkpoint_id
        resp = self._http.request("POST", f"/vms/{vm_id}/fork", json=body)
        data = resp.json()
        track_event("sdk.fork", {"count": count})
        return ForkResult(
            source_vm_id=data["source_vm_id"],
            checkpoint_id=data["checkpoint_id"],
            vms=[_parse_vm(v) for v in data["vms"]],
        )

    def fork_tree(self, vm_id: str) -> ForkTree:
        resp = self._http.request("GET", f"/vms/{vm_id}/tree")
        return _parse_fork_tree(resp.json())

    # ==================== Lifecycle ====================

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> Superserve:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


# ==================== Parsers ====================


def _parse_vm(data: dict[str, Any]) -> Vm:
    return Vm(
        id=data["id"],
        name=data["name"],
        status=data["status"],
        vcpu_count=data["vcpu_count"],
        mem_size_mib=data["mem_size_mib"],
        ip_address=data.get("ip_address"),
        created_at=data["created_at"],
        uptime_seconds=data["uptime_seconds"],
        last_checkpoint_at=data.get("last_checkpoint_at"),
        parent_vm_id=data.get("parent_vm_id"),
        forked_from_checkpoint_id=data.get("forked_from_checkpoint_id"),
    )


def _parse_checkpoint(data: dict[str, Any]) -> Checkpoint:
    return Checkpoint(
        id=data["id"],
        vm_id=data["vm_id"],
        name=data.get("name"),
        type=data["type"],
        size_bytes=data["size_bytes"],
        delta_size_bytes=data["delta_size_bytes"],
        created_at=data["created_at"],
        pinned=data["pinned"],
    )


def _parse_fork_tree(data: dict[str, Any]) -> ForkTree:
    return ForkTree(
        vm_id=data["vm_id"],
        name=data["name"],
        status=data["status"],
        forked_from_checkpoint_id=data.get("forked_from_checkpoint_id"),
        children=[_parse_fork_tree(c) for c in data.get("children", [])],
    )
