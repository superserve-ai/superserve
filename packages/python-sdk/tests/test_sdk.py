"""Tests for superserve SDK — Client, types, and errors."""

from superserve import Checkpoint, ExecResult, ForkResult, ForkTree, Superserve, Vm
from superserve.errors import APIError, SuperserveError


class TestTypes:
    """Tests for data classes."""

    def test_vm_creation(self):
        vm = Vm(
            id="vm_abc123",
            name="test-vm",
            status="RUNNING",
            vcpu_count=2,
            mem_size_mib=512,
            ip_address="172.16.0.2",
            created_at="2026-03-22T10:00:00Z",
            uptime_seconds=3600,
            last_checkpoint_at=None,
            parent_vm_id=None,
            forked_from_checkpoint_id=None,
        )
        assert vm.id == "vm_abc123"
        assert vm.name == "test-vm"
        assert vm.status == "RUNNING"
        assert vm.vcpu_count == 2
        assert vm.ip_address == "172.16.0.2"

    def test_exec_result(self):
        result = ExecResult(stdout="hello\n", stderr="", exit_code=0)
        assert result.stdout == "hello\n"
        assert result.exit_code == 0

    def test_checkpoint(self):
        cp = Checkpoint(
            id="cp_001",
            vm_id="vm_abc123",
            name="baseline",
            type="named",
            size_bytes=1024,
            delta_size_bytes=256,
            created_at="2026-03-22T10:00:00Z",
            pinned=True,
        )
        assert cp.id == "cp_001"
        assert cp.pinned is True

    def test_fork_result(self):
        vm = Vm(
            id="vm_fork_01",
            name="fork-1",
            status="RUNNING",
            vcpu_count=1,
            mem_size_mib=256,
            ip_address=None,
            created_at="2026-03-22T12:00:00Z",
            uptime_seconds=0,
            last_checkpoint_at=None,
            parent_vm_id="vm_abc123",
            forked_from_checkpoint_id="cp_003",
        )
        result = ForkResult(
            source_vm_id="vm_abc123",
            checkpoint_id="cp_003",
            vms=[vm],
        )
        assert result.source_vm_id == "vm_abc123"
        assert len(result.vms) == 1
        assert result.vms[0].parent_vm_id == "vm_abc123"

    def test_fork_tree(self):
        tree = ForkTree(
            vm_id="vm_abc123",
            name="root",
            status="RUNNING",
            forked_from_checkpoint_id=None,
            children=[
                ForkTree(
                    vm_id="vm_fork_01",
                    name="fork-1",
                    status="RUNNING",
                    forked_from_checkpoint_id="cp_003",
                    children=[],
                )
            ],
        )
        assert tree.vm_id == "vm_abc123"
        assert len(tree.children) == 1
        assert tree.children[0].forked_from_checkpoint_id == "cp_003"


class TestErrors:
    """Tests for error classes."""

    def test_superserve_error(self):
        err = SuperserveError("something went wrong")
        assert str(err) == "something went wrong"
        assert isinstance(err, Exception)

    def test_api_error(self):
        err = APIError(404, "not_found", "VM vm_abc123 not found.")
        assert err.status_code == 404
        assert err.code == "not_found"
        assert err.message == "VM vm_abc123 not found."
        assert isinstance(err, SuperserveError)

    def test_api_error_str(self):
        err = APIError(401, "unauthorized", "Invalid API key.")
        assert "[401]" in str(err)
        assert "Invalid API key." in str(err)


class TestClientInit:
    """Tests for Superserve client initialization."""

    def test_client_creates_namespaces(self):
        client = Superserve(api_key="test-key")
        assert hasattr(client, "vms")
        assert hasattr(client, "files")
        assert hasattr(client, "checkpoints")
        assert hasattr(client, "exec")
        assert hasattr(client, "fork")
        assert hasattr(client, "rollback")
        assert hasattr(client, "fork_tree")
        client.close()

    def test_client_context_manager(self):
        with Superserve(api_key="test-key") as client:
            assert hasattr(client, "vms")
