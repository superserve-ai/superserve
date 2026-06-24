# LangChain + LangGraph Integration — Contribution Research

**Date:** 2026-06-24
**Question:** What do we need to do to contribute a Superserve sandbox integration to LangChain + LangGraph's open-source projects?
**Cousin of:** [`2026-06-23-agno-integration-research.md`](./2026-06-23-agno-integration-research.md) (same "wrap our `commands.run`/`files.*` SDK into a 3rd-party agent framework" shape) and Tier-2 item #4 in [`2026-06-16-agent-framework-integrations-research.md`](./2026-06-16-agent-framework-integrations-research.md).

> **Confidence:** Core findings verified against primary source (deepagents `protocol.py` + `partners/daytona/sandbox.py` raw files, the `libs/partners` GitHub tree, and the live `docs.langchain.com` contributing/sandboxes pages) on 2026-06-24. The entire "Sandboxes for Deep Agents" line is **post-Jan-2026** (launched 2025-11-13, expanded since) — re-verify package names/versions at build time. `deepagents` is **pre-1.0 and moving fast**; pin a version.

---

## 1. One-sentence finding

**A Superserve LangChain/LangGraph integration is a ~100-line `SuperserveSandbox(BaseSandbox)` class published as a standalone `langchain-superserve` PyPI package — you implement exactly four members (`id`, `execute`, `upload_files`, `download_files`), inherit the entire filesystem tool surface for free, and it works in LangChain, LangGraph, and DeepAgents at once because DeepAgents _is_ a LangGraph harness.** It is a near-exact 1:1 map onto our existing SDK, lower-friction than the Agno integration, and there is an officially documented contribution path with a standard test suite.

---

## 2. The landscape shifted (read this first)

LangChain's **1.0 release (late 2025)** restructured how integrations are contributed. Two consequences that invalidate most older blog posts/tutorials:

1. **`langchain-community` is sunset and archived** (repo made read-only 2026-06-19). It accepts no new integrations. The legacy `E2BDataAnalysisTool` and `langchain-sandbox` (Pyodide/WASM) are **removed/deprecated** — do **not** copy them.
2. **New integrations are standalone PyPI packages**, conventionally `langchain-<provider>`. You do **not** PR integration code into `langchain-ai/langchain`. The old `libs/packages.yml` registry is **gone** (404).

There are now **two generations** of "run code in a sandbox" integration. Only Gen-2 is current:

|          | Gen-1 (legacy, dead)                              | **Gen-2 (current canonical)**                                   |
| -------- | ------------------------------------------------- | --------------------------------------------------------------- |
| Shape    | standalone `BaseTool` subclass                    | **`BaseSandbox` backend** (DeepAgents `SandboxBackendProtocol`) |
| Examples | `E2BDataAnalysisTool`, Riza `ExecPython`, Pyodide | **Daytona, Modal, Runloop, Vercel, E2B, AgentCore**             |
| Status   | removed / community-archived                      | actively maintained, documented contribution path               |

**The Gen-2 `BaseSandbox` protocol is an almost exact match for Superserve's API** (`commands.run()` + `files.read/write`). The file to mirror is `langchain_daytona/sandbox.py` — Daytona is the structural twin of Superserve (real cloud microVM, shell `execute` + real filesystem upload/download).

---

## 3. What "LangChain + LangGraph integration" actually means

This matters because the user named both. Resolved:

- **LangGraph has no separate sandbox/tool extension point.** A "LangGraph integration" is just a LangChain `BaseTool` consumed by `ToolNode` / `create_react_agent`. There is nothing LangGraph-native to register. The only "registry" in LangGraph-world is the deployment-layer agent catalog (LangGraph Platform), which is **not** a tool/sandbox surface.
- **DeepAgents is a LangGraph harness.** `create_deep_agent(...)` returns a _compiled LangGraph graph_. So implementing the DeepAgents `BaseSandbox` backend is simultaneously the LangChain integration **and** the LangGraph integration for the surface that matters to a sandbox vendor.
- **Coverage gap:** users who run _vanilla_ LangGraph (`create_react_agent` with plain tools, **no** DeepAgents) won't pull a `BaseSandbox`. To serve them too, ship a thin plain `@tool` alongside the backend (see §7). This is the one decision where "LangChain + LangGraph" is broader than "DeepAgents."

**→ Primary deliverable: the DeepAgents `BaseSandbox` backend. Secondary (optional): a plain `BaseTool` for non-DeepAgents LangGraph users.**

---

## 4. The exact interface to implement (verified from source)

`from deepagents.backends.sandbox import BaseSandbox` (ABC) / `deepagents.backends.protocol.SandboxBackendProtocol`.

**Return dataclasses** (verbatim from `backends/protocol.py`):

```python
@dataclass
class ExecuteResponse:
    output: str                    # combined stdout + stderr
    exit_code: int | None = None   # 0 = success
    truncated: bool = False

@dataclass
class FileUploadResponse:
    path: str
    error: FileOperationError | str | None = None   # None on success

@dataclass
class FileDownloadResponse:
    path: str
    content: bytes | None = None    # bytes on success, None on failure
    error: FileOperationError | str | None = None
```

**You MUST implement only these 4 members** (`@abstractmethod` on `BaseSandbox`; async `a*` variants for the async path):

```python
@property
def id(self) -> str: ...
def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse: ...
def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]: ...
def download_files(self, paths: list[str]) -> list[FileDownloadResponse]: ...
```

**You get these for free** from `BaseSandbox` (all synthesized from `execute()` / `upload_files()`):
`ls`, `read`, `write`, `edit`, `grep`, `glob` (+ async). `write` delegates to `upload_files`; `ls`/`read`/`grep`/`glob` run as shell/`python3 -c` scripts through `execute()`.

> **The missing `files.list` is a NON-ISSUE.** DeepAgents never calls a backend `files.list` — it builds directory listings itself with a `python3 -c "os.scandir(...)"` script routed through `execute()`. As long as our `execute()` returns combined output + exit code, `ls`/`read`/`grep`/`glob` all work automatically. The `ls`-via-shell shim we worried about for Agno is already done for us here.

---

## 5. Superserve SDK → `BaseSandbox` mapping (1:1, verified field names)

Our SDK (confirmed): `sandbox.id: str`; `sandbox.commands.run(command, *, timeout_seconds=…) -> CommandResult(stdout, stderr, exit_code)`; `sandbox.files.write(path, content: str|bytes) -> None`; `sandbox.files.read(path) -> bytes`. `AsyncSandbox` mirrors all of it.

```python
# package: langchain-superserve
from deepagents.backends.sandbox import BaseSandbox
from deepagents.backends.protocol import (
    ExecuteResponse, FileUploadResponse, FileDownloadResponse,
)
from superserve import Sandbox
from superserve.errors import NotFoundError

class SuperserveSandbox(BaseSandbox):
    def __init__(self, *, sandbox: Sandbox) -> None:
        self._sandbox = sandbox          # a connected Superserve Sandbox

    @property
    def id(self) -> str:
        return self._sandbox.id

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        r = self._sandbox.commands.run(command, timeout_seconds=timeout)
        return ExecuteResponse(
            output=r.stdout + r.stderr,  # protocol wants combined; Daytona combines too
            exit_code=r.exit_code,
            truncated=False,
        )

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        out = []
        for path, data in files:
            try:
                self._sandbox.files.write(path, data)
                out.append(FileUploadResponse(path=path, error=None))
            except Exception as e:                       # normalize per protocol
                out.append(FileUploadResponse(path=path, error=str(e)))
        return out

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        out = []
        for path in paths:
            try:
                out.append(FileDownloadResponse(path=path, content=self._sandbox.files.read(path)))
            except NotFoundError:
                out.append(FileDownloadResponse(path=path, error="file_not_found"))
        return out
    # + async aexecute / aupload_files / adownload_files backed by AsyncSandbox
```

Even tighter than Agno (no `files.list` shim; `commands.run` already returns exactly stdout/stderr/exit_code). Mirror `langchain-daytona`'s `__init__(*, sandbox, timeout=1800, ...)` convention.

**Confirm at build time:** exact `FileOperationError` literals (e.g. `"file_not_found"`) in `protocol.py`/`utils.py`, and whether `truncated` should reflect any Superserve output cap.

---

## 6. Contribution mechanics — two routes

The reference packages (`langchain-daytona`, `-modal`, `-runloop`, `-vercel-sandbox`, `quickjs`) **do** live in the `langchain-ai/deepagents` monorepo under `libs/partners/` — but those are LangChain's curated **first-party** set. The contributing docs tell **third parties** to publish their own package and PR docs only. So:

### Route A — Own package (the documented, default path)

1. Build `langchain-superserve` (the `SuperserveSandbox` above) in **our own repo** (or a `packages/langchain-superserve` workspace).
2. Package it like `langchain-daytona`: **hatchling** build backend, **uv** (`uv.lock`), **ruff** lint/format, **`ty`** type-check (Astral's checker — _not_ mypy), `requires-python = ">=3.11"`, dep on `deepagents>=…` + `superserve`.
3. Pass **standard tests**: subclass `SandboxIntegrationTests` from `langchain_tests.integration_tests` (`langchain-tests>=1.1.9` as a test dep), provide a fixture yielding a clean `SuperserveSandbox`.
4. **Publish to PyPI** as `langchain-superserve`.
5. Open **one docs-only PR** to `github.com/langchain-ai/docs` adding an integration page (copy their tools/sandbox template). Optionally email LangChain to be "featured on the integrations page."
   - ⚠️ Their contributing rules: **approval-before-PR** (link an issue a maintainer approved); English-only; **AI-assisted PRs allowed but must be human-verified and not look bot-generated** (aligns with our "no AI attribution" commit rule); effort bar (don't submit low-effort PRs).

- **Pros:** sanctioned path, ships immediately, we own release cadence, no code gating. **Cons:** not visually in `libs/partners` next to competitors; discovery via PyPI + docs page.

### Route B — Upstream into the deepagents monorepo (`libs/partners/superserve`)

PR a first-party package alongside Daytona/Modal/Runloop/Vercel.

- **Pros:** strongest consideration-set placement — sits in-repo next to direct competitors; implicit endorsement (this placement is the actual adoption driver per our 06-16 brief). **Cons:** contributing docs explicitly **discourage** integration PRs into langchain-ai repos; needs maintainer buy-in; slower; may be declined.

### Recommendation

**Build the Route-A artifact first** (the `SuperserveSandbox` class + tests are identical work either way, so we keep optionality), publish to PyPI, and land the docs PR. **In parallel, open a GitHub issue/conversation** with the deepagents maintainers asking whether they'd accept a first-party `libs/partners/superserve` or feature us — because Superserve is a real microVM provider exactly like the Daytona/Modal/Vercel packages they already curate, there's a genuine chance they say yes, and that placement is worth more than the code. Decide placement on their response; the package ships regardless.

---

## 7. TypeScript twin + optional plain tool

- **TS (`deepagentsjs`):** same architecture. Implement `class SuperserveSandbox extends BaseSandbox` with `execute` / `uploadFiles` / `downloadFiles` (returns `{output, exitCode, truncated}`), validate with `@langchain/sandbox-standard-tests`, publish `@langchain/superserve` (or our own scope). Mirror `@langchain/daytona`. **Gotcha:** the JS protocol name is inconsistent in docs (`SandboxBackendProtocol` vs `SandboxBackendProtocolV2`) — version-pin and verify against the installed npm package. Maps onto our TS SDK (`sandbox.commands.run`, `sandbox.files.read/write`).
- **Optional plain `@tool` (covers vanilla LangGraph users with no DeepAgents dep):** a `langchain-core`-only `BaseTool` (e.g. `superserve_exec(command) -> str`) so `create_react_agent(model, tools=[...])` users can call Superserve without pulling `deepagents`. The plain-tool contribution path is "WIP" in LangChain docs with no standard-test class, so treat it as a value-add, not the listing vehicle. Consider gating the `deepagents` dependency behind an extra (`langchain-superserve[deepagents]`) so the plain tool stays dependency-light.

---

## 8. Differentiators to surface (ship richer than Daytona/E2B)

Per [[superserve-auth-tenancy-model]] and the Agno brief, expose Superserve-only value in the README/docs page and constructor ergonomics:

- **`pause()` / `resume()`** — idle cost savings; no competitor backend advertises this.
- **Proxy-brokered secret binding** (`Sandbox.create(secrets=…)`) — real credentials never enter the sandbox; a security selling point for agent workloads.
- A `SuperserveSandbox.create(...)` classmethod/factory that creates+connects a sandbox in one call (DeepAgents passes an already-connected `sandbox=`; a factory is friendlier).

These live outside the `BaseSandbox` protocol but are legitimate differentiators in the integration's surface and marketing.

---

## 9. Effort estimate & sequencing

| Step                                                                          | Effort   |
| ----------------------------------------------------------------------------- | -------- |
| `langchain-superserve` Python pkg (`SuperserveSandbox` sync+async, packaging) | ~1 day   |
| `SandboxIntegrationTests` standard tests                                      | ~0.5 day |
| Docs-only PR to `langchain-ai/docs` (+ maintainer issue)                      | ~0.5 day |
| Optional plain `@tool` for vanilla LangGraph                                  | ~0.5 day |
| TS `@langchain/superserve` for `deepagentsjs`                                 | ~1 day   |

**~2–3 days Python + listing; +1 day for TS.** Lower friction than Agno.

**Sequence:** (1) Python `BaseSandbox` backend + standard tests → PyPI; (2) docs PR + maintainer outreach (Route A/B decision); (3) optional plain tool; (4) TS twin.

---

## 10. Open decisions

1. **Repo location:** standalone repo vs a `packages/langchain-superserve` workspace in this monorepo. (Monorepo keeps it with our SDK; standalone matches LangChain's "your own org" wording and avoids coupling our oxlint/oxfmt tooling to their ruff/`ty` requirements.)
2. **Route A vs B** for placement (recommend A-first, ask about B).
3. **Plain `@tool` in v1?** Needed for non-DeepAgents LangGraph coverage; cheap. Lean yes, behind an optional structure.
4. **Sync-only vs sync+async** — async is trivial here (`AsyncSandbox` exists) and DeepAgents uses the async path heavily; ship **both**.
5. **`deepagents` version pin** — it's pre-1.0 and fast-moving; pin and watch.

---

## 11. Gotchas / flags

- `langchain-community` (Py) and `@langchain/community` (JS) are **dead** for new integrations — never target them.
- **Do not copy** `E2BDataAnalysisTool` (removed) or `langchain-sandbox`/Pyodide (deprecated, WASM-only, file-less). Copy `langchain-daytona`.
- `libs/packages.yml` registry **no longer exists** — any guide referencing it is stale; listing is now a docs-repo PR.
- Type-check with **`ty`**, not mypy; build with **hatchling**+**uv**, not Poetry; **Python ≥3.11** in the reference (our SDK supports ≥3.9, but match the reference for the partner package).
- `langchain-e2b`'s exact published home is **still settling** (not yet a `libs/partners/e2b` dir) — verify before using it as a secondary reference.
- Everything Sandboxes-for-DeepAgents is **post-Jan-2026**; `deepagents` is pre-1.0. Pin versions; verify package/class names live before publishing.

---

## Sources (primary, verified 2026-06-24)

- DeepAgents sandboxes: https://docs.langchain.com/oss/python/deepagents/sandboxes · JS: https://docs.langchain.com/oss/javascript/deepagents/sandboxes
- Contributing integrations (publish-your-own-package policy): https://docs.langchain.com/oss/python/contributing/integrations-langchain · overview: https://docs.langchain.com/oss/python/contributing/overview
- `BaseSandbox` ref: https://reference.langchain.com/python/deepagents/backends/sandbox/BaseSandbox
- Source — `protocol.py`: https://raw.githubusercontent.com/langchain-ai/deepagents/main/libs/deepagents/deepagents/backends/protocol.py
- Source — `backends/sandbox.py`: https://raw.githubusercontent.com/langchain-ai/deepagents/main/libs/deepagents/deepagents/backends/sandbox.py
- Reference impl — `partners/daytona/langchain_daytona/sandbox.py` (verified in-repo) + `pyproject.toml`
- `libs/partners` tree (daytona, modal, quickjs, runloop, vercel): https://github.com/langchain-ai/deepagents/tree/main/libs/partners
- deepagentsjs (TS): https://github.com/langchain-ai/deepagentsjs · `@langchain/daytona`: https://www.npmjs.com/package/@langchain/daytona
- Standard tests: `langchain-tests` (PyPI) → `langchain_tests.integration_tests.SandboxIntegrationTests`
- `langchain-community` sunset/archive: https://github.com/langchain-ai/langchain-community/issues/674
- Launch: https://www.langchain.com/blog/execute-code-with-sandboxes-for-deepagents · "two patterns by which agents connect sandboxes": https://blog.langchain.com/the-two-patterns-by-which-agents-connect-sandboxes/
