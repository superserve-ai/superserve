# langchain-superserve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `langchain-superserve`, a standalone PyPI package that adapts a Superserve sandbox to the DeepAgents `BaseSandbox` protocol, so Superserve reaches feature parity with the other sandbox providers (Daytona/Modal/Runloop/Vercel/E2B) across LangChain, LangGraph, and DeepAgents.

**Architecture:** A thin (~110-line) `SuperserveSandbox(BaseSandbox)` adapter implementing the four abstract members (`id`, `execute`, `upload_files`, `download_files`); the protocol synthesizes `ls`/`read`/`write`/`edit`/`grep`/`glob` on top of `execute()` and our file methods. A `SuperserveProvider` exposes the package to the `deepagents-code` CLI via a packaging entry-point. Sync-only — async comes free from the protocol's `asyncio.to_thread` wrappers (this is exactly how the E2B reference works). The package is a **standalone public repo**, structurally cloned from `e2b-dev/langchain-e2b` (our closest peer: OSS, general code sandbox).

**Tech Stack:** Python ≥3.11, `deepagents` (DeepAgents protocol), `superserve` (our SDK), hatchling (build), uv (deps/lock), ruff (lint/format), `ty` (type-check — Astral's checker, **not mypy**), pytest + `langchain-tests` (standard suite), `deepagents-code` (provider, test-only dep).

## Global Constraints

Every task implicitly includes these. Exact values, copied verbatim:

- **Repo root:** `/Users/mohamedmorsi/Career/Superserve/work/langchain-superserve` (new standalone public repo; **not** inside the `superserve` monorepo).
- **Reference to mirror:** `/Users/mohamedmorsi/Career/Superserve/work/references/langchain-e2b` (already cloned). Diff against it for every file.
- **Import package name:** `langchain_superserve`. **PyPI distribution name:** `langchain-superserve`.
- **Build backend:** `hatchling`. **Runtime deps:** `deepagents>=0.6.0,<0.7.0`, `superserve>=0.7.6`.
- **`requires-python = ">=3.11,<4.0"`** (DeepAgents floor; the Superserve SDK itself supports ≥3.9, but match the partner-package floor).
- **Type-check with `ty`, lint/format with `ruff`** (`select = ["ALL"]`, google docstrings, `ban-relative-imports = "all"`). **Never mypy.**
- **Test-only deps (uv `[dependency-groups].test`):** `pytest`, `pytest-cov`, `pytest-socket`, `pytest-xdist`, `pytest-timeout`, `pytest-asyncio`, `ruff`, `ty`, `langchain-tests>=1.1.6`, `deepagents-code>=0.1.19,<0.2.0`.
- **`DEFAULT_WORKDIR = "/home/user"`** (verified: default cwd on both `superserve/base` and `superserve/python-3.11`).
- **Default provider template:** `"superserve/python-3.11"` (the integration's file ops need `python3` — see "Verified runtime facts").
- **Env var:** `SUPERSERVE_API_KEY` (+ `DEEPAGENTS_CODE_SUPERSERVE_API_KEY` prefix honored by the provider, mirroring E2B's `DEEPAGENTS_CODE_*` convention).
- **`FileOperationError` literals (exact):** `"file_not_found"`, `"permission_denied"`, `"is_directory"`, `"invalid_path"`.
- **Commits:** single-line messages, **no AI attribution / no Co-Authored-By** (Superserve project rule).

---

## Verified runtime facts (read before coding)

All verified live on 2026-06-24 against the actual SDK source, the DeepAgents `main` protocol, and live Superserve sandboxes. These are the load-bearing facts the code depends on.

**Superserve Python SDK (`superserve` v0.7.6 PyPI / v0.7.7 in-repo):**

- `Sandbox.create(*, name: str, from_template=None, from_snapshot=None, timeout_seconds=None, metadata=None, env_vars=None, secrets=None, network=None, api_key=None, base_url=None) -> Sandbox` — **`name` is required**.
- `Sandbox.connect(sandbox_id, *, api_key=None, base_url=None) -> Sandbox` — auto-resumes, fresh token. **No `timeout` param.**
- `Sandbox.kill_by_id(sandbox_id, *, api_key=None, base_url=None) -> None` — **idempotent** (swallows `NotFoundError`).
- `sandbox.id: str`.
- `sandbox.commands.run(command, *, cwd=None, env=None, timeout_seconds=None, ...) -> CommandResult(stdout: str, stderr: str, exit_code: int)` — **does NOT raise on non-zero exit**; returns `exit_code`. (Differs from E2B's `CommandExitException`.)
- `sandbox.files.write(path, content: str|bytes) -> None`; `sandbox.files.read(path) -> bytes`. Both call `_validate_path` → raise `ValidationError` if path is not absolute or contains `..`.
- Error hierarchy (all subclass `SandboxError`): `AuthenticationError`, `ValidationError`, `NotFoundError`, `ConflictError`, `SandboxTimeoutError`, `ServerError`, `RateLimitError`, `BuildError`. Import from `superserve` or `superserve.errors`.
- API key resolved from `api_key=` arg or `SUPERSERVE_API_KEY` env var.

**DeepAgents `BaseSandbox` (`deepagents>=0.6`, pre-1.0):**

- `from deepagents.backends.sandbox import BaseSandbox`; dataclasses from `deepagents.backends.protocol`.
- **Exactly 4 abstract members:** `execute(command, *, timeout: int | None = None) -> ExecuteResponse`, `id` (property), `upload_files(list[tuple[str, bytes]]) -> list[FileUploadResponse]`, `download_files(list[str]) -> list[FileDownloadResponse]`.
- Async (`aexecute`/`aupload_files`/`adownload_files`) **default to `asyncio.to_thread` wrappers** — no override needed.
- `ExecuteResponse(output: str, exit_code: int | None = None, truncated: bool = False)`; `FileUploadResponse(path: str, error=None)`; `FileDownloadResponse(path: str, content: bytes | None = None, error=None)`.
- The protocol introspects whether `execute` accepts a kwarg literally named `timeout` — **keep the param name `timeout`**.
- **Synthesized file ops require `python3` in the sandbox**: `ls`, `read`, `write`-preflight, `glob`, `edit` all run inline `python3 -c "..."` scripts via `execute()`. Only `grep` is pure-shell (`grep -rHnFZ`). `upload_files`/`download_files` are OUR code (Superserve files API) and need no python3.

**Live Superserve runtime (verified by probing real sandboxes):**

- **Default image (`superserve/base`, the no-template default): Ubuntu 24.04, user `root`, cwd `/home/user`. Has `sh`/`bash`/`grep`/`find`/`ls`/`cat`/`sed`/`base64`/`perl`/`awk`. NO `python3`/`python`/`node`/`rg`.** → On the default image, `execute`/`grep`/`upload_files`/`download_files` work, but `ls`/`read`/`write`/`edit`/`glob` FAIL (python3 missing).
- **`superserve/python-3.11` template** (status `ready`): cwd `/home/user`, `python3` 3.11.15 at `/usr/local/bin/python3`. The actual DeepAgents synthesized `ls` (python3/os.scandir) and `grep` (shell) commands were run on it and produced correct output. → **The integration passes the standard suite on this template.** Other python templates: `superserve/python-ml`, `superserve/code-interpreter`.
- `execute` does **not** truncate ≥600 KiB stdout (`truncated=false`) → the `test_execute_large_stdout_payload` standard test (≥500 KiB, `truncated is False`) passes.

**`SandboxIntegrationTests` (from `langchain-tests`) error-code contract:**

- `test_download_error_file_not_found` → **requires** `error == "file_not_found"` for a missing file.
- `test_download_error_invalid_path_relative` → **requires** `FileDownloadResponse(path=<relative>, content=None, error="invalid_path")`.
- `test_download_error_is_directory` → `error in {"is_directory", "file_not_found", "invalid_path"}` (lenient).
- `test_download_error_permission_denied` → `error in {"permission_denied", "file_not_found", "invalid_path"}` (lenient).
- `test_upload_relative_path_returns_invalid_path` → **requires** `FileUploadResponse(path=<relative>, error="invalid_path")`.
- `test_upload_missing_parent_dir_or_roundtrip` → succeeds (roundtrip) OR `error in {"invalid_path","permission_denied","file_not_found"}`.
- `test_write_creates_parent_dirs` → the synthesized `write` must create parent dirs (relies on Superserve `files.write` creating parents — see build-time checklist).

---

## File Structure

New repo at `/Users/mohamedmorsi/Career/Superserve/work/langchain-superserve`. Mirrors the E2B reference 1:1 (swap `e2b`→`superserve`):

```
langchain-superserve/
├── langchain_superserve/
│   ├── __init__.py          # exports SuperserveSandbox
│   ├── _version.py          # __version__ = "0.0.1"
│   ├── sandbox.py           # SuperserveSandbox(BaseSandbox) — the adapter (Tasks 2-3)
│   └── provider.py          # SuperserveProvider(SandboxProvider) — dcode entry-point (Task 4)
├── tests/
│   ├── __init__.py
│   ├── unit_tests/
│   │   ├── __init__.py
│   │   ├── test_imports.py      # import smoke test (Task 1)
│   │   ├── test_sandbox.py      # fake-SDK unit tests (Tasks 2-3)
│   │   └── test_provider.py     # mocked-classmethod provider tests (Task 4)
│   └── integration_tests/
│       ├── __init__.py
│       └── test_integration.py  # SandboxIntegrationTests + provider (Task 5, credentialed)
├── .github/workflows/
│   ├── ci.yml               # test (3.11-3.14) + lint + build (Task 1)
│   └── release.yml          # PyPI publish on tag (Task 6)
├── pyproject.toml           # Task 1
├── Makefile                 # Task 1
├── README.md                # Task 1 stub → Task 6 full
├── CHANGELOG.md             # Task 6
├── LICENSE                  # Task 1 (MIT)
├── .gitignore               # Task 1
└── uv.lock                  # generated by `uv sync` (Task 1)
```

Each file has one responsibility: `sandbox.py` = the backend adapter; `provider.py` = lifecycle/CLI integration; tests split unit (no network) vs integration (credentialed).

---

## Task 1: Repo scaffold + packaging

**Files:**

- Create: `langchain-superserve/pyproject.toml`, `Makefile`, `LICENSE`, `.gitignore`, `README.md` (stub), `langchain_superserve/__init__.py`, `langchain_superserve/_version.py`, `langchain_superserve/sandbox.py` (minimal stub), all `__init__.py` test files, `.github/workflows/ci.yml`
- Test: `tests/unit_tests/test_imports.py`

**Interfaces:**

- Produces: the `langchain_superserve` package importable; `SuperserveSandbox` symbol exported (stub body replaced in Tasks 2-3).

- [ ] **Step 1: Create the repo and git-init**

```bash
mkdir -p /Users/mohamedmorsi/Career/Superserve/work/langchain-superserve
cd /Users/mohamedmorsi/Career/Superserve/work/langchain-superserve
git init
mkdir -p langchain_superserve tests/unit_tests tests/integration_tests .github/workflows
```

- [ ] **Step 2: Write `pyproject.toml`** (mirrors the E2B reference; swaps name/deps/entry-point)

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "langchain-superserve"
description = "Superserve sandbox integration for Deep Agents"
license = { text = "MIT" }
readme = "README.md"
classifiers = [
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Programming Language :: Python :: 3.13",
    "Programming Language :: Python :: 3.14",
    "Topic :: Scientific/Engineering :: Artificial Intelligence",
]
version = "0.0.1"
requires-python = ">=3.11,<4.0"
dependencies = [
    "deepagents>=0.6.0,<0.7.0",
    "superserve>=0.7.6",
]

[project.entry-points."deepagents_code.sandbox_providers"]
superserve = "langchain_superserve.provider:SuperserveProvider"

[tool.hatch.build.targets.wheel]
packages = ["langchain_superserve"]

[project.urls]
Homepage = "https://github.com/superserve/langchain-superserve"
Repository = "https://github.com/superserve/langchain-superserve"
Documentation = "https://github.com/superserve/langchain-superserve#readme"
Issues = "https://github.com/superserve/langchain-superserve/issues"

[dependency-groups]
test = [
    "pytest>=7.3.0,<10.0.0",
    "pytest-cov",
    "pytest-socket",
    "pytest-xdist",
    "pytest-timeout>=2.3.1,<3.0.0",
    "pytest-asyncio>=1.3.0",
    "ruff>=0.13.1,<0.16.0",
    "ty>=0.0.1,<1.0.0",
    "langchain-tests>=1.1.6",
    "deepagents-code>=0.1.19,<0.2.0",
]

[tool.ty.environment]
python-version = "3.11"

[tool.ruff.format]
docstring-code-format = true

[tool.ruff.lint]
select = ["ALL"]
ignore = [
    "COM812",
    "ISC001",
    "ANN401",
]

[tool.ruff.lint.pydocstyle]
convention = "google"
ignore-var-parameters = true

[tool.ruff.lint.flake8-tidy-imports]
ban-relative-imports = "all"

[tool.coverage.run]
omit = ["tests/*"]

[tool.pytest.ini_options]
addopts = "--strict-markers --strict-config --durations=5"
testpaths = ["tests"]
markers = [
    "requires: mark tests as requiring a specific library",
    "compile: mark placeholder test used to compile integration tests without running them",
    "scheduled: mark tests to run in scheduled testing",
]
asyncio_mode = "auto"
filterwarnings = []

[tool.ruff.lint.extend-per-file-ignores]
"tests/**/*.py" = ["D", "S101"]
```

- [ ] **Step 3: Write `Makefile`** (copy E2B's verbatim, replacing `langchain_e2b` → `langchain_superserve`)

```makefile
.PHONY: format lint type typecheck test tests integration_test integration_tests test_watch help lint_package

.DEFAULT_GOAL := help
.EXPORT_ALL_VARIABLES:
UV_FROZEN = true

TEST_FILE ?= tests/unit_tests/
PYTEST_EXTRA ?=

integration_test integration_tests: TEST_FILE=tests/integration_tests/

test: ## Run unit tests
test tests:
	uv run --group test pytest -vvv $(PYTEST_EXTRA) --disable-socket --allow-unix-socket $(TEST_FILE)

integration_test: ## Run integration tests
integration_test integration_tests:
	uv run --group test pytest -vvv --timeout 60 $(TEST_FILE)

PYTHON_FILES=.
lint format: PYTHON_FILES=.
lint_package: PYTHON_FILES=langchain_superserve

lint: ## Run linters and type checker
lint lint_package:
	[ "$(PYTHON_FILES)" = "" ] || uv run --all-groups ruff check $(PYTHON_FILES)
	[ "$(PYTHON_FILES)" = "" ] || uv run --all-groups ruff format $(PYTHON_FILES) --diff
	$(MAKE) type

type: ## Run type checker
type typecheck:
	uv run --all-groups ty check langchain_superserve

format: ## Run code formatters
format:
	[ "$(PYTHON_FILES)" = "" ] || uv run --all-groups ruff format $(PYTHON_FILES)
	[ "$(PYTHON_FILES)" = "" ] || uv run --all-groups ruff check --fix $(PYTHON_FILES)

help: ## Show this help message
	@echo "Usage: make [target]"
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
```

- [ ] **Step 4: Write `LICENSE`** (MIT — copy `references/langchain-e2b/LICENSE`, update the copyright holder to Superserve), **`.gitignore`** (`.venv/`, `__pycache__/`, `dist/`, `*.egg-info/`, `.pytest_cache/`, `.ruff_cache/`, `.coverage`), and a one-line **`README.md`** stub (`# langchain-superserve` — expanded in Task 6).

- [ ] **Step 5: Write `langchain_superserve/_version.py`**

```python
__version__ = "0.0.1"
```

- [ ] **Step 6: Write `langchain_superserve/__init__.py`**

```python
"""Superserve sandbox integration for Deep Agents."""

from langchain_superserve.sandbox import SuperserveSandbox

__all__ = ["SuperserveSandbox"]
```

- [ ] **Step 7: Write a minimal `langchain_superserve/sandbox.py` stub** (so the import resolves; the real body lands in Tasks 2-3)

```python
"""Superserve sandbox backend implementation."""

from __future__ import annotations

from deepagents.backends.protocol import (
    ExecuteResponse,
    FileDownloadResponse,
    FileUploadResponse,
)
from deepagents.backends.sandbox import BaseSandbox
from superserve import Sandbox


class SuperserveSandbox(BaseSandbox):
    """Sandbox backend that operates on an existing Superserve sandbox."""

    def __init__(self, *, sandbox: Sandbox) -> None:
        """Wrap an existing Superserve sandbox."""
        self._sandbox = sandbox

    @property
    def id(self) -> str:
        """Return the Superserve sandbox id."""
        return self._sandbox.id

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        """Execute a shell command (implemented in Task 2)."""
        raise NotImplementedError

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        """Upload files (implemented in Task 3)."""
        raise NotImplementedError

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        """Download files (implemented in Task 3)."""
        raise NotImplementedError
```

- [ ] **Step 8: Create empty `__init__.py`** in `tests/`, `tests/unit_tests/`, `tests/integration_tests/` (empty files).

- [ ] **Step 9: Write the failing import test** `tests/unit_tests/test_imports.py`

```python
from langchain_superserve import SuperserveSandbox


def test_import_sandbox() -> None:
    assert SuperserveSandbox is not None
```

- [ ] **Step 10: Sync deps and run the test — verify it passes**

```bash
cd /Users/mohamedmorsi/Career/Superserve/work/langchain-superserve
uv sync --group test
make test
```

Expected: `uv sync` writes `uv.lock`; `test_import_sandbox` PASSES.

- [ ] **Step 11: Verify lint, type-check, and build are green**

```bash
make lint
uv build --no-sources
```

Expected: ruff + `ty` pass; `dist/langchain_superserve-0.0.1*.whl` + `.tar.gz` built.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold langchain-superserve package"
```

---

## Task 2: `SuperserveSandbox` — `id` + `execute`

**Files:**

- Modify: `langchain_superserve/sandbox.py` (replace `__init__`, `id`, `execute`; add `_combine_output` + constants)
- Test: `tests/unit_tests/test_sandbox.py` (create; fake SDK)

**Interfaces:**

- Consumes: `superserve.Sandbox` (duck-typed via a fake), `superserve.errors.{SandboxError, SandboxTimeoutError}`.
- Produces: `SuperserveSandbox(*, sandbox, workdir="/home/user", timeout=1800)`; `.id -> str`; `.execute(command, *, timeout=None) -> ExecuteResponse(output, exit_code, truncated=False)`. Module constants `DEFAULT_WORKDIR="/home/user"`, `DEFAULT_TIMEOUT=1800`, `TIMEOUT_EXIT_CODE=124`.

- [ ] **Step 1: Write the failing tests** `tests/unit_tests/test_sandbox.py` (fake SDK; mirrors E2B's `FakeCommands`/`FakeSandbox`, adapted to Superserve's `timeout_seconds` and no-raise-on-nonzero semantics)

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, cast

import pytest
from superserve.errors import SandboxError, SandboxTimeoutError

from langchain_superserve import SuperserveSandbox

if TYPE_CHECKING:
    from superserve import Sandbox

TEST_TIMEOUT = 7
TIMEOUT_EXIT_CODE = 124


@dataclass
class FakeCommandResult:
    stdout: str
    stderr: str
    exit_code: int


@dataclass
class FakeCommands:
    result: FakeCommandResult | None = None
    exc: BaseException | None = None
    cwd: str | None = None
    timeout_seconds: int | None = None

    def run(
        self,
        command: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout_seconds: int | None = None,
    ) -> FakeCommandResult:
        self.cwd = cwd
        self.timeout_seconds = timeout_seconds
        if self.exc is not None:
            raise self.exc
        assert command
        assert self.result is not None
        return self.result


@dataclass
class FakeFiles:
    entries: dict[str, bytes] = field(default_factory=dict)
    read_exc: BaseException | None = None
    write_exc: BaseException | None = None

    def read(self, path: str) -> bytes:
        if self.read_exc is not None:
            raise self.read_exc
        return self.entries[path]

    def write(self, path: str, content: str | bytes) -> None:
        if self.write_exc is not None:
            raise self.write_exc
        self.entries[path] = content if isinstance(content, bytes) else content.encode()


@dataclass
class FakeSandbox:
    commands: FakeCommands
    files: FakeFiles
    id: str = "sbx_test"


def _backend(
    *,
    commands: FakeCommands | None = None,
    files: FakeFiles | None = None,
    workdir: str = "/home/user",
    timeout: int = 30 * 60,
) -> SuperserveSandbox:
    fake = FakeSandbox(
        commands=commands
        or FakeCommands(result=FakeCommandResult(stdout="", stderr="", exit_code=0)),
        files=files or FakeFiles(),
    )
    return SuperserveSandbox(
        sandbox=cast("Sandbox", fake), workdir=workdir, timeout=timeout
    )


def test_id_returns_superserve_sandbox_id() -> None:
    assert _backend().id == "sbx_test"


def test_execute_success_uses_workdir_and_timeout() -> None:
    commands = FakeCommands(
        result=FakeCommandResult(stdout="hello\n", stderr="", exit_code=0)
    )
    backend = _backend(commands=commands, workdir="/workspace", timeout=TEST_TIMEOUT)

    result = backend.execute("echo hello")

    assert result.output == "hello\n"
    assert result.exit_code == 0
    assert result.truncated is False
    assert commands.cwd == "/workspace"
    assert commands.timeout_seconds == TEST_TIMEOUT


def test_execute_combines_stdout_and_stderr() -> None:
    backend = _backend(
        commands=FakeCommands(
            result=FakeCommandResult(stdout="out", stderr="err", exit_code=0)
        )
    )
    result = backend.execute("echo hello")
    assert result.output == "out\nerr"


def test_execute_nonzero_exit_returns_response() -> None:
    backend = _backend(
        commands=FakeCommands(
            result=FakeCommandResult(stdout="", stderr="boom", exit_code=1)
        )
    )
    result = backend.execute("false")
    assert result.output == "boom"
    assert result.exit_code == 1


def test_execute_timeout_returns_timeout_response() -> None:
    backend = _backend(commands=FakeCommands(exc=SandboxTimeoutError("timed out")))
    result = backend.execute("sleep 10", timeout=5)
    assert result.output == "Command timed out after 5 seconds"
    assert result.exit_code == TIMEOUT_EXIT_CODE


def test_execute_sandbox_error_returns_error_response() -> None:
    backend = _backend(commands=FakeCommands(exc=SandboxError("kaboom")))
    result = backend.execute("whatever")
    assert result.exit_code == 1
    assert "kaboom" in result.output


def test_execute_rejects_negative_timeout() -> None:
    with pytest.raises(ValueError, match="timeout must be non-negative"):
        _backend().execute("echo hello", timeout=-1)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
make test
```

Expected: FAIL — `execute` raises `NotImplementedError` (stub from Task 1); `__init__` rejects `workdir`/`timeout` kwargs.

- [ ] **Step 3: Implement `id` + `execute`** — replace the body of `langchain_superserve/sandbox.py`

```python
"""Superserve sandbox backend implementation."""

from __future__ import annotations

from deepagents.backends.protocol import (
    ExecuteResponse,
    FileDownloadResponse,
    FileUploadResponse,
)
from deepagents.backends.sandbox import BaseSandbox
from superserve import Sandbox
from superserve.errors import SandboxError, SandboxTimeoutError

DEFAULT_WORKDIR = "/home/user"
DEFAULT_TIMEOUT = 30 * 60
TIMEOUT_EXIT_CODE = 124


def _combine_output(stdout: str | None, stderr: str | None) -> str:
    output = stdout or ""
    if stderr:
        output += "\n" + stderr if output else stderr
    return output


class SuperserveSandbox(BaseSandbox):
    """Sandbox backend that operates on an existing Superserve sandbox."""

    def __init__(
        self,
        *,
        sandbox: Sandbox,
        workdir: str = DEFAULT_WORKDIR,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> None:
        """Create a backend wrapping an existing Superserve sandbox.

        Args:
            sandbox: Existing connected Superserve sandbox instance to wrap.
            workdir: Working directory for command execution.
            timeout: Default command timeout in seconds when ``execute()`` is
                called without an explicit ``timeout``.
        """
        self._sandbox = sandbox
        self._workdir = workdir
        self._default_timeout = timeout

    @property
    def id(self) -> str:
        """Return the Superserve sandbox id."""
        return self._sandbox.id

    def execute(
        self,
        command: str,
        *,
        timeout: int | None = None,
    ) -> ExecuteResponse:
        """Execute a shell command inside the sandbox.

        Args:
            command: Shell command string to execute.
            timeout: Maximum time in seconds to wait for this command. If
                ``None``, uses the backend's default timeout.

        Returns:
            ExecuteResponse with combined output, exit code, and truncation flag.

        Raises:
            ValueError: If ``timeout`` is negative.
        """
        effective_timeout = timeout if timeout is not None else self._default_timeout
        if effective_timeout < 0:
            msg = f"timeout must be non-negative, got {effective_timeout}"
            raise ValueError(msg)

        try:
            result = self._sandbox.commands.run(
                command,
                cwd=self._workdir,
                timeout_seconds=effective_timeout,
            )
        except SandboxTimeoutError:
            return ExecuteResponse(
                output=f"Command timed out after {effective_timeout} seconds",
                exit_code=TIMEOUT_EXIT_CODE,
                truncated=False,
            )
        except SandboxError as exc:
            return ExecuteResponse(
                output=f"Error executing command ({type(exc).__name__}): {exc}",
                exit_code=1,
                truncated=False,
            )

        return ExecuteResponse(
            output=_combine_output(result.stdout, result.stderr),
            exit_code=result.exit_code,
            truncated=False,
        )

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        """Upload files (implemented in Task 3)."""
        raise NotImplementedError

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        """Download files (implemented in Task 3)."""
        raise NotImplementedError
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
make test
```

Expected: all 7 `test_*` PASS.

- [ ] **Step 5: Lint + type-check, then commit**

```bash
make lint
git add -A
git commit -m "feat: implement SuperserveSandbox id and execute"
```

---

## Task 3: `SuperserveSandbox` — `upload_files` + `download_files`

**Files:**

- Modify: `langchain_superserve/sandbox.py` (replace `upload_files`/`download_files` stubs; add `_read_file`/`_write_file`; add `import shlex` and the error imports)
- Test: `tests/unit_tests/test_sandbox.py` (append cases)

**Interfaces:**

- Consumes: `superserve.errors.{NotFoundError, ValidationError, SandboxError}`; `self.execute` (for the directory probe).
- Produces: `download_files(paths) -> list[FileDownloadResponse]` and `upload_files(files) -> list[FileUploadResponse]`, order-preserving, mapping errors to the `FileOperationError` literals.

- [ ] **Step 1: Append failing tests** to `tests/unit_tests/test_sandbox.py`

```python
from superserve.errors import NotFoundError, ValidationError

TEST_FILE_PATH = "/home/user/file.txt"
TEST_DIR_PATH = "/home/user/data"


def test_download_rejects_relative_path() -> None:
    response = _backend().download_files(["relative.txt"])[0]
    assert response.error == "invalid_path"
    assert response.content is None


def test_download_missing_file_maps_to_file_not_found() -> None:
    files = FakeFiles(read_exc=NotFoundError("nope"))
    response = _backend(files=files).download_files([TEST_FILE_PATH])[0]
    assert response.error == "file_not_found"
    assert response.content is None


def test_download_validation_error_maps_to_invalid_path() -> None:
    files = FakeFiles(read_exc=ValidationError("bad path"))
    response = _backend(files=files).download_files([TEST_FILE_PATH])[0]
    assert response.error == "invalid_path"


def test_download_directory_maps_to_is_directory() -> None:
    # files.read raises a generic SandboxError; the `test -d` probe returns 0.
    files = FakeFiles(read_exc=SandboxError("cannot read directory"))
    commands = FakeCommands(
        result=FakeCommandResult(stdout="", stderr="", exit_code=0)
    )
    response = _backend(files=files, commands=commands).download_files([TEST_DIR_PATH])[
        0
    ]
    assert response.error == "is_directory"


def test_download_unknown_error_falls_back_to_file_not_found() -> None:
    # files.read raises a generic SandboxError; the `test -d` probe returns 1.
    files = FakeFiles(read_exc=SandboxError("boom"))
    commands = FakeCommands(
        result=FakeCommandResult(stdout="", stderr="", exit_code=1)
    )
    response = _backend(files=files, commands=commands).download_files([TEST_FILE_PATH])[
        0
    ]
    assert response.error == "file_not_found"


def test_upload_rejects_relative_path() -> None:
    response = _backend().upload_files([("relative.txt", b"hello")])[0]
    assert response.error == "invalid_path"


def test_upload_validation_error_maps_to_invalid_path() -> None:
    files = FakeFiles(write_exc=ValidationError("bad path"))
    response = _backend(files=files).upload_files([(TEST_FILE_PATH, b"hi")])[0]
    assert response.error == "invalid_path"


def test_upload_and_download_round_trip() -> None:
    files = FakeFiles()
    backend = _backend(files=files)
    upload = backend.upload_files([(TEST_FILE_PATH, b"hello")])[0]
    download = backend.download_files([TEST_FILE_PATH])[0]
    assert upload.error is None
    assert download.error is None
    assert download.content == b"hello"


def test_upload_download_order_preserved() -> None:
    files = FakeFiles()
    backend = _backend(files=files)
    paths = [f"/home/user/f{i}.txt" for i in range(5)]
    backend.upload_files([(p, str(i).encode()) for i, p in enumerate(paths)])
    responses = backend.download_files(paths)
    assert [r.path for r in responses] == paths
    assert [r.content for r in responses] == [str(i).encode() for i in range(5)]
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
make test
```

Expected: FAIL — `upload_files`/`download_files` raise `NotImplementedError`.

- [ ] **Step 3: Implement the file methods** — replace the two stubs in `langchain_superserve/sandbox.py`, and update the imports at the top of the file

Update the import block to:

```python
import shlex

from deepagents.backends.protocol import (
    ExecuteResponse,
    FileDownloadResponse,
    FileUploadResponse,
)
from deepagents.backends.sandbox import BaseSandbox
from superserve import Sandbox
from superserve.errors import (
    NotFoundError,
    SandboxError,
    SandboxTimeoutError,
    ValidationError,
)
```

Replace the two stub methods with:

```python
    def _read_file(self, path: str) -> FileDownloadResponse:
        if not path.startswith("/"):
            return FileDownloadResponse(path=path, content=None, error="invalid_path")
        try:
            content = self._sandbox.files.read(path)
        except NotFoundError:
            return FileDownloadResponse(path=path, content=None, error="file_not_found")
        except ValidationError:
            return FileDownloadResponse(path=path, content=None, error="invalid_path")
        except SandboxError:
            # Superserve has no stat API. A non-NotFound read failure is most
            # likely a directory; classify with a `test -d` probe and fall back
            # to file_not_found (both are accepted by the standard suite).
            probe = self.execute(f"test -d {shlex.quote(path)}")
            error = "is_directory" if probe.exit_code == 0 else "file_not_found"
            return FileDownloadResponse(path=path, content=None, error=error)
        return FileDownloadResponse(path=path, content=content, error=None)

    def _write_file(self, path: str, content: bytes) -> FileUploadResponse:
        if not path.startswith("/"):
            return FileUploadResponse(path=path, error="invalid_path")
        try:
            self._sandbox.files.write(path, content)
        except ValidationError:
            return FileUploadResponse(path=path, error="invalid_path")
        except NotFoundError:
            return FileUploadResponse(path=path, error="file_not_found")
        except SandboxError as exc:
            return FileUploadResponse(path=path, error=str(exc))
        return FileUploadResponse(path=path, error=None)

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        """Download files from the sandbox, in the same order as ``paths``."""
        return [self._read_file(path) for path in paths]

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        """Upload files into the sandbox, in the same order as ``files``."""
        return [self._write_file(path, content) for path, content in files]
```

> **Exception-order note:** `NotFoundError` and `ValidationError` both subclass `SandboxError`, so they MUST be caught before the broad `SandboxError` clause (as written). Same for `SandboxTimeoutError` in `execute`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
make test
```

Expected: all unit tests PASS (Task 2 + Task 3 cases).

- [ ] **Step 5: Lint + type-check, then commit**

```bash
make lint
git add -A
git commit -m "feat: implement SuperserveSandbox upload_files and download_files"
```

---

## Task 4: `SuperserveProvider` + `deepagents-code` entry-point

This is the third table-stakes artifact (alongside the backend and standard tests): it makes Superserve selectable as `dcode --sandbox superserve` in the `deepagents-code` terminal CLI. The entry-point is already declared in `pyproject.toml` (Task 1, Step 2); this task implements the class it points at.

> **⚠️ Pre-1.0 surface — verify before coding.** `deepagents_code.integrations.sandbox_provider` is from the pre-1.0 `deepagents-code` package (pinned `>=0.1.19,<0.2.0`). Mirror `references/langchain-e2b/langchain_e2b/provider.py` exactly and confirm the imported names (`SandboxProvider`, `SandboxProviderMetadata`, `SandboxInstallHint`, `SandboxNotFoundError`) against the installed version first: `uv run python -c "import deepagents_code.integrations.sandbox_provider as m; print(dir(m))"`.

**Files:**

- Create: `langchain_superserve/provider.py`
- Test: `tests/unit_tests/test_provider.py`

**Interfaces:**

- Consumes: `SuperserveSandbox`, `DEFAULT_WORKDIR` (from `sandbox.py`); `superserve.Sandbox.{create,connect,kill_by_id}`; `superserve.errors.NotFoundError`; `deepagents_code.integrations.sandbox_provider.*`.
- Produces: `SuperserveProvider(*, resolve_env_var=None)`; `.metadata`; `.get_or_create(*, sandbox_id=None, timeout=None, template=None, workdir="/home/user", command_timeout=None) -> SuperserveSandbox`; `.delete(*, sandbox_id) -> None`. Module constants `DEFAULT_SANDBOX_TIMEOUT`, `DEFAULT_COMMAND_TIMEOUT`, `DEFAULT_TEMPLATE="superserve/python-3.11"`.

- [ ] **Step 1: Write the failing tests** `tests/unit_tests/test_provider.py`

```python
from __future__ import annotations

from importlib.metadata import entry_points
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast
from unittest.mock import patch

import pytest
from superserve.errors import NotFoundError

from langchain_superserve import SuperserveSandbox
from langchain_superserve.provider import (
    DEFAULT_COMMAND_TIMEOUT,
    DEFAULT_SANDBOX_TIMEOUT,
    DEFAULT_TEMPLATE,
    SuperserveProvider,
)

if TYPE_CHECKING:
    from collections.abc import Callable

TEST_COMMAND_TIMEOUT = 42


def _resolver(values: dict[str, str]) -> Callable[[str], str | None]:
    return values.get


def _sandbox(sandbox_id: str = "sbx-test"):
    sandbox = SimpleNamespace(id=sandbox_id)
    sandbox.commands = SimpleNamespace(
        run=lambda *a, **k: SimpleNamespace(stdout="", stderr="", exit_code=0)
    )
    return sandbox


def test_provider_metadata_does_not_require_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SUPERSERVE_API_KEY", raising=False)
    metadata = SuperserveProvider().metadata
    assert metadata.name == "superserve"
    assert metadata.working_dir == "/home/user"
    assert metadata.supports_sandbox_id is True
    assert metadata.backend_module == "langchain_superserve"
    assert metadata.install is not None
    assert metadata.install.name == "langchain-superserve"


def test_entry_point_loads_provider() -> None:
    entries = entry_points(group="deepagents_code.sandbox_providers")
    entry = next(item for item in entries if item.name == "superserve")
    assert entry.value == "langchain_superserve.provider:SuperserveProvider"
    assert entry.load() is SuperserveProvider


def test_provider_creates_sandbox_with_default_template() -> None:
    sandbox = _sandbox("sbx-new")
    with patch(
        "langchain_superserve.provider.Sandbox.create", return_value=sandbox
    ) as create:
        provider = SuperserveProvider(
            resolve_env_var=_resolver({"SUPERSERVE_API_KEY": "fake-key"})
        )
        backend = provider.get_or_create()
    assert isinstance(backend, SuperserveSandbox)
    assert backend.id == "sbx-new"
    create.assert_called_once()
    kwargs = create.call_args.kwargs
    assert kwargs["from_template"] == DEFAULT_TEMPLATE
    assert kwargs["timeout_seconds"] == DEFAULT_SANDBOX_TIMEOUT
    assert kwargs["api_key"] == "fake-key"
    assert kwargs["name"].startswith("dcode-")


def test_provider_creates_sandbox_with_curated_options() -> None:
    sandbox = _sandbox("sbx-template")
    with patch(
        "langchain_superserve.provider.Sandbox.create", return_value=sandbox
    ) as create:
        provider = SuperserveProvider(
            resolve_env_var=_resolver({"SUPERSERVE_API_KEY": "fake-key"})
        )
        backend = provider.get_or_create(
            timeout=7200,
            template="superserve/python-ml",
            workdir="/workspace",
            command_timeout=TEST_COMMAND_TIMEOUT,
        )
    kwargs = create.call_args.kwargs
    assert kwargs["from_template"] == "superserve/python-ml"
    assert kwargs["timeout_seconds"] == 7200
    assert backend.id == "sbx-template"
    # command_timeout flows into the backend's default execute timeout
    backend.execute("true")
    assert backend._default_timeout == TEST_COMMAND_TIMEOUT  # noqa: SLF001


def test_provider_reads_template_and_timeout_from_environment() -> None:
    sandbox = _sandbox()
    resolver = _resolver(
        {
            "SUPERSERVE_API_KEY": "fake-key",
            "SUPERSERVE_TEMPLATE": "superserve/code-interpreter",
            "SUPERSERVE_SANDBOX_TIMEOUT": "3600",
        }
    )
    with patch(
        "langchain_superserve.provider.Sandbox.create", return_value=sandbox
    ) as create:
        SuperserveProvider(resolve_env_var=resolver).get_or_create()
    kwargs = create.call_args.kwargs
    assert kwargs["from_template"] == "superserve/code-interpreter"
    assert kwargs["timeout_seconds"] == 3600


def test_provider_connects_existing_sandbox() -> None:
    sandbox = _sandbox("sbx-existing")
    with patch(
        "langchain_superserve.provider.Sandbox.connect", return_value=sandbox
    ) as connect:
        provider = SuperserveProvider(
            resolve_env_var=_resolver({"SUPERSERVE_API_KEY": "fake-key"})
        )
        backend = provider.get_or_create(sandbox_id="sbx-existing")
    connect.assert_called_once_with("sbx-existing", api_key="fake-key")
    assert backend.id == "sbx-existing"


def test_provider_maps_missing_sandbox_to_sandbox_not_found() -> None:
    from deepagents_code.integrations.sandbox_provider import SandboxNotFoundError

    with patch(
        "langchain_superserve.provider.Sandbox.connect",
        side_effect=NotFoundError("missing"),
    ):
        provider = SuperserveProvider(
            resolve_env_var=_resolver({"SUPERSERVE_API_KEY": "fake-key"})
        )
        with pytest.raises(SandboxNotFoundError) as exc_info:
            provider.get_or_create(sandbox_id="sbx-missing")
    assert exc_info.value.args == ("sbx-missing",)


def test_provider_delete_is_idempotent() -> None:
    with patch("langchain_superserve.provider.Sandbox.kill_by_id") as kill:
        provider = SuperserveProvider(
            resolve_env_var=_resolver({"SUPERSERVE_API_KEY": "fake-key"})
        )
        provider.delete(sandbox_id="sbx-delete")
    kill.assert_called_once_with("sbx-delete", api_key="fake-key")


def test_provider_requires_api_key() -> None:
    provider = SuperserveProvider(resolve_env_var=_resolver({}))
    with pytest.raises(
        ValueError, match=r"SUPERSERVE_API_KEY.*DEEPAGENTS_CODE_SUPERSERVE_API_KEY"
    ):
        provider.get_or_create()


def test_provider_rejects_unsupported_get_options() -> None:
    provider = SuperserveProvider(resolve_env_var=_resolver({}))
    with pytest.raises(TypeError, match="Received unsupported arguments: metadata"):
        provider.get_or_create(metadata={"purpose": "test"})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
make test
```

Expected: FAIL — `langchain_superserve.provider` does not exist.

- [ ] **Step 3: Implement `langchain_superserve/provider.py`** (mirrors E2B's provider; Superserve-adapted)

```python
"""Superserve sandbox lifecycle provider for Deep Agents Code."""

from __future__ import annotations

import os
import uuid
from collections.abc import Callable
from typing import NoReturn

from deepagents_code.integrations.sandbox_provider import (
    SandboxInstallHint,
    SandboxNotFoundError,
    SandboxProvider,
    SandboxProviderMetadata,
)
from superserve import Sandbox
from superserve.errors import NotFoundError

from langchain_superserve.sandbox import DEFAULT_WORKDIR, SuperserveSandbox

DEFAULT_SANDBOX_TIMEOUT = 30 * 60
DEFAULT_COMMAND_TIMEOUT = 30 * 60
DEFAULT_TEMPLATE = "superserve/python-3.11"

EnvResolver = Callable[[str], str | None]


def _default_resolve_env_var(name: str) -> str | None:
    if not name.startswith("DEEPAGENTS_CODE_"):
        prefixed = f"DEEPAGENTS_CODE_{name}"
        if prefixed in os.environ:
            return os.environ[prefixed] or None
    return os.environ.get(name) or None


def _resolve_optional_env_var(resolve_env_var: EnvResolver, name: str) -> str | None:
    return resolve_env_var(name) or None


def _resolve_int(
    value: int | str | None,
    *,
    name: str,
    default: int,
    allow_zero: bool = False,
) -> int:
    if value is None:
        return default
    try:
        resolved = int(value)
    except (TypeError, ValueError) as exc:
        msg = f"{name} must be an integer number of seconds"
        raise ValueError(msg) from exc
    lower_bound = 0 if allow_zero else 1
    if resolved < lower_bound:
        requirement = "non-negative" if allow_zero else "positive"
        msg = f"{name} must be {requirement}"
        raise ValueError(msg)
    return resolved


def _raise_unsupported_kwargs(kwargs: dict[str, object]) -> NoReturn:
    names = ", ".join(sorted(kwargs))
    msg = f"Received unsupported arguments: {names}"
    raise TypeError(msg)


class SuperserveProvider(SandboxProvider):
    """Manage Superserve sandboxes for Deep Agents Code."""

    _metadata = SandboxProviderMetadata(
        name="superserve",
        working_dir=DEFAULT_WORKDIR,
        install=SandboxInstallHint(kind="package", name="langchain-superserve"),
        supports_sandbox_id=True,
        supports_snapshot_name=False,
        backend_module="langchain_superserve",
    )

    def __init__(self, *, resolve_env_var: EnvResolver | None = None) -> None:
        """Initialize the provider without touching credentials."""
        self._resolve_env_var = resolve_env_var or _default_resolve_env_var

    @property
    def metadata(self) -> SandboxProviderMetadata:
        """Return metadata used by Deep Agents Code provider discovery."""
        return self._metadata

    def get_or_create(
        self,
        *,
        sandbox_id: str | None = None,
        timeout: int | str | None = None,
        template: str | None = None,
        workdir: str = DEFAULT_WORKDIR,
        command_timeout: int | str | None = None,
        **kwargs: object,
    ) -> SuperserveSandbox:
        """Get or create a Superserve sandbox backend.

        Args:
            sandbox_id: Existing Superserve sandbox ID, or ``None`` to create one.
            timeout: Sandbox idle-timeout in seconds (auto-pause).
            template: Superserve template for new sandboxes (defaults to a
                python-equipped image so the synthesized file ops work).
            workdir: Working directory used by command execution.
            command_timeout: Default command timeout for the backend.
            **kwargs: Unsupported provider options.

        Returns:
            Superserve sandbox backend.

        Raises:
            SandboxNotFoundError: If ``sandbox_id`` does not exist.
            TypeError: If unsupported provider options are passed.
            ValueError: If credentials or timeout settings are invalid.
        """
        if kwargs:
            _raise_unsupported_kwargs(kwargs)

        api_key = self._resolve_api_key()
        sandbox_timeout = self._resolve_sandbox_timeout(timeout)
        default_command_timeout = _resolve_int(
            command_timeout,
            name="command_timeout",
            default=DEFAULT_COMMAND_TIMEOUT,
            allow_zero=True,
        )

        if sandbox_id is not None:
            try:
                sandbox = Sandbox.connect(sandbox_id, api_key=api_key)
            except NotFoundError as exc:
                raise SandboxNotFoundError(sandbox_id) from exc
        else:
            resolved_template = (
                template
                or _resolve_optional_env_var(self._resolve_env_var, "SUPERSERVE_TEMPLATE")
                or DEFAULT_TEMPLATE
            )
            sandbox = Sandbox.create(
                name=f"dcode-{uuid.uuid4().hex[:12]}",
                from_template=resolved_template,
                timeout_seconds=sandbox_timeout,
                api_key=api_key,
            )

        return SuperserveSandbox(
            sandbox=sandbox,
            workdir=workdir,
            timeout=default_command_timeout,
        )

    def delete(self, *, sandbox_id: str, **kwargs: object) -> None:
        """Delete a Superserve sandbox. Idempotent (Superserve swallows 404).

        Args:
            sandbox_id: Superserve sandbox ID.
            **kwargs: Unsupported provider options.

        Raises:
            TypeError: If unsupported provider options are passed.
            ValueError: If credentials are missing.
        """
        if kwargs:
            _raise_unsupported_kwargs(kwargs)
        Sandbox.kill_by_id(sandbox_id, api_key=self._resolve_api_key())

    def _resolve_api_key(self) -> str:
        api_key = _resolve_optional_env_var(self._resolve_env_var, "SUPERSERVE_API_KEY")
        if not api_key:
            msg = (
                "No Superserve API key found. Set SUPERSERVE_API_KEY or "
                "DEEPAGENTS_CODE_SUPERSERVE_API_KEY."
            )
            raise ValueError(msg)
        return api_key

    def _resolve_sandbox_timeout(self, timeout: int | str | None) -> int:
        env_timeout = (
            None
            if timeout is not None
            else _resolve_optional_env_var(
                self._resolve_env_var, "SUPERSERVE_SANDBOX_TIMEOUT"
            )
        )
        return _resolve_int(
            timeout if timeout is not None else env_timeout,
            name="timeout",
            default=DEFAULT_SANDBOX_TIMEOUT,
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
make test
```

Expected: all provider unit tests PASS. (If imports from `deepagents_code` fail, the pinned version's API drifted — reconcile against the live `dir()` output from the Step-0 verify command, then re-run.)

- [ ] **Step 5: Lint + type-check, then commit**

```bash
make lint
git add -A
git commit -m "feat: add SuperserveProvider for deepagents-code CLI"
```

---

## Task 5: Standard integration tests (credentialed)

Wires the canonical `SandboxIntegrationTests` suite (the parity bar — every competitor passes it) plus a provider end-to-end test. Both **skip cleanly without `SUPERSERVE_API_KEY`**, so CI unit runs are unaffected. The subclass overrides the abstract `sandbox` fixture (yielding the backend); the base wires `sandbox_backend` from it — verified against the live `langchain-tests` source and the E2B reference.

**Files:**

- Create: `tests/integration_tests/test_integration.py`

**Interfaces:**

- Consumes: `langchain_tests.integration_tests.SandboxIntegrationTests`; `superserve.Sandbox`; `SuperserveSandbox`; `SuperserveProvider`.

- [ ] **Step 1: Write the integration test** `tests/integration_tests/test_integration.py`

```python
from __future__ import annotations

import os
from typing import TYPE_CHECKING

import pytest
from langchain_tests.integration_tests import SandboxIntegrationTests
from superserve import Sandbox

from langchain_superserve import SuperserveSandbox
from langchain_superserve.provider import SuperserveProvider

if TYPE_CHECKING:
    from collections.abc import Iterator

    from deepagents.backends.protocol import SandboxBackendProtocol

DEFAULT_TEMPLATE = "superserve/python-3.11"


class TestSuperserveSandboxStandard(SandboxIntegrationTests):
    @pytest.fixture(scope="class")
    def sandbox(self) -> Iterator[SandboxBackendProtocol]:
        api_key = os.environ.get("SUPERSERVE_API_KEY")
        if not api_key:
            pytest.skip("Missing SUPERSERVE_API_KEY for Superserve integration test")
        template = os.environ.get("SUPERSERVE_TEMPLATE", DEFAULT_TEMPLATE)
        sandbox = Sandbox.create(
            name="lc-superserve-itest",
            from_template=template,
            timeout_seconds=60 * 60,
            api_key=api_key,
        )
        backend = SuperserveSandbox(sandbox=sandbox)
        try:
            yield backend
        finally:
            Sandbox.kill_by_id(sandbox.id, api_key=api_key)


def test_superserve_provider_creates_executes_and_deletes_sandbox() -> None:
    api_key = os.environ.get("SUPERSERVE_API_KEY")
    if not api_key:
        pytest.skip("Missing SUPERSERVE_API_KEY for Superserve provider test")

    provider = SuperserveProvider()
    sandbox_id: str | None = None
    try:
        backend = provider.get_or_create(command_timeout=30)
        sandbox_id = backend.id
        result = backend.execute("echo provider-ready", timeout=10)
        assert result.exit_code == 0
        assert "provider-ready" in result.output
    finally:
        if sandbox_id is not None:
            provider.delete(sandbox_id=sandbox_id)
```

- [ ] **Step 2: Run the integration suite against a real sandbox** (requires a key)

```bash
SUPERSERVE_API_KEY=ss_live_... make integration_tests
```

Expected: the full `SandboxIntegrationTests` suite + the provider test PASS on `superserve/python-3.11`. Work through the **Build-time verification checklist** below for any failures (most likely candidates: `write`-creates-parents and read-on-directory behavior).

- [ ] **Step 3: Verify the suite skips cleanly without a key**

```bash
unset SUPERSERVE_API_KEY
make integration_tests
```

Expected: all integration tests SKIP (no failures, no network).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: add Superserve standard integration tests"
```

---

## Task 6: README, CHANGELOG, release workflow, publish prep

**Files:**

- Modify: `README.md` (full)
- Create: `CHANGELOG.md`, `.github/workflows/release.yml`

- [ ] **Step 1: Write the full `README.md`** (mirror E2B's; Superserve-specific quickstart + the python-template requirement + differentiators)

````markdown
# langchain-superserve

[![PyPI - Version](https://img.shields.io/pypi/v/langchain-superserve?label=%20)](https://pypi.org/project/langchain-superserve/#history)

Superserve sandbox integration for Deep Agents (works with LangChain + LangGraph,
since DeepAgents compiles to a LangGraph graph).

## Quick Install

```bash
pip install langchain-superserve
```

## Deep Agents SDK

```python
from superserve import Sandbox
from langchain_superserve import SuperserveSandbox

# Use a python-equipped template so the agent's file tools (ls/read/edit/glob) work.
sandbox = Sandbox.create(name="my-agent", from_template="superserve/python-3.11")
backend = SuperserveSandbox(sandbox=sandbox)

try:
    result = backend.execute("echo hello")
    print(result.output)
finally:
    sandbox.kill()
```

## Deep Agents Code

```bash
dcode --install langchain-superserve --package
export SUPERSERVE_API_KEY=ss_live_...
dcode --sandbox superserve
```

## Requirements

`SuperserveSandbox` adapts a Superserve sandbox to the Deep Agents sandbox
protocol. The protocol synthesizes `ls`/`read`/`edit`/`glob` with in-sandbox
`python3`, so launch from a python-equipped image — `superserve/python-3.11`,
`superserve/python-ml`, or `superserve/code-interpreter`. `execute`, `grep`,
and file upload/download work on any image.

## Superserve extras

Beyond the standard backend, Superserve sandboxes also offer `pause()`/`resume()`
for idle cost savings and proxy-brokered secret binding (`Sandbox.create(secrets=...)`)
so real credentials never enter the sandbox — manage these through the Superserve
SDK on the sandbox you pass in.

## Development

```bash
uv sync --group test
make test
make lint
SUPERSERVE_API_KEY=ss_live_... make integration_tests
```
````

- [ ] **Step 2: Write `CHANGELOG.md`** with an initial `## 0.0.1` entry summarizing the first release.

- [ ] **Step 3: Write `.github/workflows/release.yml`** — copy `references/langchain-e2b/.github/workflows/release.yml`, adjusting the package name. (Trusted publishing to PyPI via `uv build --no-sources` + `uv publish` on a `v*` tag; `permissions: id-token: write`.)

- [ ] **Step 4: Build and validate the distribution metadata**

```bash
uv build --no-sources
uv run --with twine twine check dist/*
```

Expected: build succeeds; `twine check` PASSES (README renders, metadata valid).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: add README, changelog, and release workflow"
```

- [ ] **Step 6 (manual, gated): Publish to PyPI + push the repo.** Create the `superserve/langchain-superserve` GitHub repo, push `main`, then either tag `v0.0.1` (triggers `release.yml`) or `uv publish` locally with a PyPI token. **Do not auto-run** — confirm the PyPI name and org with the maintainer first.

---

## Build-time verification checklist

These depend on Superserve server/runtime behavior that can't be fully confirmed from the SDK source alone. The integration suite (Task 5) is the verification mechanism; resolve each before claiming done:

- [ ] **`files.write` creates parent dirs.** `test_write_creates_parent_dirs` requires it. If Superserve's `POST /files` does **not** mkdir-p, prepend `execute(f"mkdir -p {shlex.quote(dirname)}")` in `_write_file`. (Verify: write to `/home/user/newdir/x.txt` on a fresh sandbox, check it lands.)
- [ ] **`files.read` on a directory raises** (vs. returning zip bytes). The `_read_file` `except SandboxError` → `test -d` probe assumes a raise. If `read` _succeeds_ on a directory, add an upfront `test -d` preflight in `_read_file` instead. (Verify via `test_download_error_is_directory`.)
- [ ] **Server-side timeout** — confirm whether an exceeded `timeout_seconds` makes `commands.run` raise `SandboxTimeoutError` (handled) or return a non-zero result (also fine, just no "timed out" message). Adjust the `except SandboxTimeoutError` branch only if needed.
- [ ] **`deepagents_code.integrations.sandbox_provider` API** matches the pinned `deepagents-code>=0.1.19,<0.2.0` (names + `SandboxProviderMetadata` fields). Reconcile against `dir()` if Task 4 imports fail.
- [ ] **`timeout=0` semantics** — confirm Superserve treats `timeout_seconds=0` sanely (the protocol says 0 _may_ disable timeouts); clamp in `execute` if it means "0-second timeout."
- [ ] Re-pin `deepagents` if a new minor (`0.7.x`) ships before release; the protocol is pre-1.0.

---

## Self-Review

**Spec coverage** (against the §6/§9 parity scope of `2026-06-24-langchain-langgraph-integration-research.md`):

- MUST #1 Python `BaseSandbox` backend → Tasks 2-3. ✅
- MUST #2 `SandboxIntegrationTests` → Task 5. ✅
- MUST #3 `deepagents-code` entry-point → Task 1 (declared) + Task 4 (implemented). ✅
- Packaging (hatchling/uv/ruff/ty, ≥3.11) → Task 1. ✅
- Differentiators (`pause`/`resume`, secret binding) → surfaced in README (Task 6). ✅
- Deferred by design (not in this plan): JS twin `@superserve/langchain` and gen-1 plain `@tool` (OPTIONAL tier — only Daytona ships both; revisit on demand).

**Placeholder scan:** No `TODO`/`TBD`/"add error handling" left; every code step shows complete code; every command shows expected output. Genuinely build-dependent items are isolated in the explicit checklist above, not hidden in task bodies. ✅

**Type/name consistency:** `SuperserveSandbox(*, sandbox, workdir, timeout)`, `id`, `execute(command, *, timeout=None)`, `upload_files`/`download_files`, `_read_file`/`_write_file`, `_combine_output`, constants `DEFAULT_WORKDIR`/`DEFAULT_TIMEOUT`/`TIMEOUT_EXIT_CODE` used identically across Tasks 2-3 and consumed unchanged by Task 4's `SuperserveProvider` and Task 5. `commands.run(..., timeout_seconds=)` and `Sandbox.create(name=, from_template=, timeout_seconds=, api_key=)` match the verified SDK signatures. ✅
