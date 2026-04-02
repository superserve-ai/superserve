"""Data types for the Superserve Python SDK."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Vm:
    """A Firecracker micro-VM."""

    id: str
    name: str
    status: str  # CREATING, RUNNING, STOPPED, SLEEPING, DEAD
    vcpu_count: int
    mem_size_mib: int
    ip_address: str | None
    created_at: str
    uptime_seconds: int
    last_checkpoint_at: str | None
    parent_vm_id: str | None
    forked_from_checkpoint_id: str | None


@dataclass
class ExecResult:
    """Result of executing a command inside a VM."""

    stdout: str
    stderr: str
    exit_code: int


@dataclass
class Checkpoint:
    """A point-in-time snapshot of a VM."""

    id: str
    vm_id: str
    name: str | None
    type: str  # auto, manual, named
    size_bytes: int
    delta_size_bytes: int
    created_at: str
    pinned: bool


@dataclass
class ForkResult:
    """Result of forking a VM."""

    source_vm_id: str
    checkpoint_id: str
    vms: list[Vm]


@dataclass
class ForkTree:
    """A node in the fork ancestry DAG."""

    vm_id: str
    name: str
    status: str
    forked_from_checkpoint_id: str | None
    children: list[ForkTree]
