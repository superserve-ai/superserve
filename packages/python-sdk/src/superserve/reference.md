# Reference
## System
<details><summary><code>client.system.<a href="src/superserve/system/client.py">health</a>() -> HealthResponse</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from superserve import Superserve
from superserve.environment import SuperserveEnvironment

client = Superserve(
    api_key="<value>",
    environment=SuperserveEnvironment.PRODUCTION,
)

client.system.health()

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Sandboxes
<details><summary><code>client.sandboxes.<a href="src/superserve/sandboxes/client.py">list_sandboxes</a>() -> typing.List[SandboxResponse]</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from superserve import Superserve
from superserve.environment import SuperserveEnvironment

client = Superserve(
    api_key="<value>",
    environment=SuperserveEnvironment.PRODUCTION,
)

client.sandboxes.list_sandboxes()

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sandboxes.<a href="src/superserve/sandboxes/client.py">create_sandbox</a>(...) -> SandboxResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a sandbox and returns immediately with `status: starting`.
The VM boots asynchronously. Poll `GET /sandboxes/{id}` until
`status` is `active` before running commands.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from superserve import Superserve
from superserve.environment import SuperserveEnvironment

client = Superserve(
    api_key="<value>",
    environment=SuperserveEnvironment.PRODUCTION,
)

client.sandboxes.create_sandbox(
    name="name",
)

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**name:** `str` — Human-readable name for the sandbox.
    
</dd>
</dl>

<dl>
<dd>

**from_snapshot:** `typing.Optional[str]` — If provided, boot the sandbox from this snapshot instead of creating a fresh VM. The snapshot must belong to the same team.
    
</dd>
</dl>

<dl>
<dd>

**network:** `typing.Optional[NetworkConfig]` 
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sandboxes.<a href="src/superserve/sandboxes/client.py">get_sandbox</a>(...) -> SandboxResponse</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from superserve import Superserve
from superserve.environment import SuperserveEnvironment

client = Superserve(
    api_key="<value>",
    environment=SuperserveEnvironment.PRODUCTION,
)

client.sandboxes.get_sandbox(
    sandbox_id="sandbox_id",
)

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**sandbox_id:** `str` — The unique identifier of the sandbox.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sandboxes.<a href="src/superserve/sandboxes/client.py">delete_sandbox</a>(...)</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from superserve import Superserve
from superserve.environment import SuperserveEnvironment

client = Superserve(
    api_key="<value>",
    environment=SuperserveEnvironment.PRODUCTION,
)

client.sandboxes.delete_sandbox(
    sandbox_id="sandbox_id",
)

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**sandbox_id:** `str` — The unique identifier of the sandbox.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sandboxes.<a href="src/superserve/sandboxes/client.py">patch_sandbox</a>(...)</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Applies a partial update to a running sandbox. Each top-level field
in the request body is optional; only fields that are present are
applied. Omitted top-level fields are left unchanged. Nested objects
are full replacements when present — to clear a list, send it as an
empty array.

At least one top-level field must be present, otherwise the request
is rejected with `400`. Unknown top-level fields are also rejected
with `400` so typos surface as errors instead of silent no-ops.

## Currently patchable fields

- `network` — replaces the egress allow/deny rules. The sandbox
  must be in the `active` state; patching a paused or idle sandbox
  returns `409`. Rules take effect immediately and are persisted so
  they survive a future pause/resume cycle.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from superserve import Superserve, NetworkConfig
from superserve.environment import SuperserveEnvironment

client = Superserve(
    api_key="<value>",
    environment=SuperserveEnvironment.PRODUCTION,
)

client.sandboxes.patch_sandbox(
    sandbox_id="sandbox_id",
    network=NetworkConfig(
        allow_out=[
            "api.openai.com",
            "*.github.com"
        ],
        deny_out=[
            "0.0.0.0/0"
        ],
    ),
)

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**sandbox_id:** `str` — The unique identifier of the sandbox.
    
</dd>
</dl>

<dl>
<dd>

**network:** `typing.Optional[NetworkConfig]` 

Replace the sandbox's egress rules. The sandbox must be in
the `active` state. The provided `allow_out` and `deny_out`
lists fully replace whatever was previously configured.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sandboxes.<a href="src/superserve/sandboxes/client.py">pause_sandbox</a>(...) -> SandboxResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Snapshots the sandbox's full state (memory + disk), suspends the VM,
and transitions to `idle`. Resume it later to continue exactly where
it left off.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from superserve import Superserve
from superserve.environment import SuperserveEnvironment

client = Superserve(
    api_key="<value>",
    environment=SuperserveEnvironment.PRODUCTION,
)

client.sandboxes.pause_sandbox(
    sandbox_id="sandbox_id",
)

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**sandbox_id:** `str` — The unique identifier of the sandbox.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sandboxes.<a href="src/superserve/sandboxes/client.py">resume_sandbox</a>(...) -> SandboxResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Restores the sandbox from its paused snapshot. Transitions back to
`active` with all state intact — same memory, same processes, same files.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from superserve import Superserve
from superserve.environment import SuperserveEnvironment

client = Superserve(
    api_key="<value>",
    environment=SuperserveEnvironment.PRODUCTION,
)

client.sandboxes.resume_sandbox(
    sandbox_id="sandbox_id",
)

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**sandbox_id:** `str` — The unique identifier of the sandbox.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Exec
<details><summary><code>client.exec.<a href="src/superserve/exec/client.py">command</a>(...) -> ExecResult</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Runs a command inside the sandbox and waits for it to finish, returning
stdout, stderr, and exit code. Idle sandboxes are automatically resumed
before execution.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from superserve import Superserve
from superserve.environment import SuperserveEnvironment

client = Superserve(
    api_key="<value>",
    environment=SuperserveEnvironment.PRODUCTION,
)

client.exec.command(
    sandbox_id="sandbox_id",
    command="command",
)

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**sandbox_id:** `str` — The unique identifier of the sandbox.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ExecRequest` 
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.exec.<a href="src/superserve/exec/client.py">command_stream</a>(...) -> typing.Iterator[bytes]</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Runs a command and streams stdout/stderr chunks as Server-Sent Events.
Each event is a JSON payload. The final event includes `exit_code` and
`finished: true`. Idle sandboxes are automatically resumed before execution.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from superserve import Superserve
from superserve.environment import SuperserveEnvironment

client = Superserve(
    api_key="<value>",
    environment=SuperserveEnvironment.PRODUCTION,
)

client.exec.command_stream(
    sandbox_id="sandbox_id",
    command="command",
)

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**sandbox_id:** `str` — The unique identifier of the sandbox.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ExecRequest` 
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Files
<details><summary><code>client.files.<a href="src/superserve/files/client.py">download_file</a>(...) -> typing.Iterator[bytes]</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Idle sandboxes are automatically resumed before the download.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from superserve import Superserve
from superserve.environment import SuperserveEnvironment

client = Superserve(
    api_key="<value>",
    environment=SuperserveEnvironment.PRODUCTION,
)

client.files.download_file(
    sandbox_id="sandbox_id",
    path="path",
)

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**sandbox_id:** `str` — The unique identifier of the sandbox.
    
</dd>
</dl>

<dl>
<dd>

**path:** `str` — File path inside the sandbox (without leading slash).
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.files.<a href="src/superserve/files/client.py">upload_file</a>(...) -> UploadFileResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Idle sandboxes are automatically resumed before the upload.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
client.files.upload_file(...)
```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**sandbox_id:** `str` — The unique identifier of the sandbox.
    
</dd>
</dl>

<dl>
<dd>

**path:** `str` — File path inside the sandbox (without leading slash).
    
</dd>
</dl>

<dl>
<dd>

**request:** `typing.Union[bytes, typing.Iterator[bytes], typing.AsyncIterator[bytes]]` 
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

