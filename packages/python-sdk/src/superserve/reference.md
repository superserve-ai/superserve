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
<details><summary><code>client.sandboxes.<a href="src/superserve/sandboxes/client.py">list_sandboxes</a>(...) -> typing.List[SandboxResponse]</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns sandboxes belonging to the authenticated team, optionally
filtered by metadata tags.

## Filtering by metadata

Any query parameter prefixed `metadata.` is treated as a filter
clause: `?metadata.env=prod&metadata.owner=agent-7`. Multiple
filters AND together — a sandbox matches only if every key/value
pair is present in its metadata. Values are compared as exact
strings; there is no type coercion or substring matching.
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

**metadata_key:** `typing.Optional[str]` 

Filter sandboxes whose metadata contains an exact `{key}: <value>`
pair. Repeat with different keys to AND multiple filters. Values
are always strings. Example: `?metadata.env=prod`.
    
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

**timeout_seconds:** `typing.Optional[int]` — Optional hard lifetime cap in seconds, measured from sandbox creation. When set, the sandbox is destroyed this many seconds after creation regardless of state (active, paused, idle) or activity — the user asked for a hard deadline. When unset, the sandbox lives until explicitly paused or deleted. Maximum 604800 (7 days).
    
</dd>
</dl>

<dl>
<dd>

**metadata:** `typing.Optional[typing.Dict[str, str]]` 

Flat string-to-string tags attached to the sandbox at creation.
Useful for grouping, owner labels, environment, run IDs, etc.

## Constraints
  - **Strings only.** Values must be strings. There is no type
    coercion: `metadata.count=42` filters for the *string* "42".
  - **At most 64 keys.**
  - Each key may be at most **256 bytes**.
  - Each value may be at most **2048 bytes** (2 KB).
  - The serialized object may be at most **16384 bytes** (16 KB)
    in total.
  - Keys starting with `superserve.` or `_superserve` (case-
    insensitive) are reserved for platform use and rejected.

Metadata can be updated after creation via `PATCH /sandboxes/:id`.
Filter sandboxes by metadata via the `metadata.{key}` query
parameter on `GET /sandboxes`.
    
</dd>
</dl>

<dl>
<dd>

**env_vars:** `typing.Optional[typing.Dict[str, str]]` 

Environment variables injected into every process inside the
sandbox (terminal sessions, exec calls). Not persisted in the
database — they live in the VM agent's memory for the sandbox's
lifetime and survive pause/resume via snapshot.
    
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
- `metadata` — replaces the sandbox's metadata tags. Can be updated
  regardless of sandbox state (active, paused, idle).
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

client.sandboxes.patch_sandbox(
    sandbox_id="sandbox_id",
    metadata={
        "env": "prod",
        "owner": "agent-7"
    },
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

**metadata:** `typing.Optional[typing.Dict[str, str]]` 

Replace the sandbox's metadata tags. Fully replaces the existing
metadata — omitted keys are removed. Can be patched regardless of
sandbox state. Same validation limits as on create (64 keys,
256-byte keys, 2 KB values, 16 KB total).
    
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

Streams the file at `path` from the sandbox as `application/octet-stream`.
Uses the same per-sandbox access token as upload.
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
    path="/home/user/data.txt",
    access_token="sb_token_from_sandbox_response",
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

**path:** `str` 

Absolute file path inside the sandbox. Must start with `/` and
must not contain `..` segments.
    
</dd>
</dl>

<dl>
<dd>

**access_token:** `str` 

Per-sandbox HMAC access token. Take this from
`SandboxResponse.access_token` on the sandbox you're reading from.
    
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

<details><summary><code>client.files.<a href="src/superserve/files/client.py">upload_file</a>(...)</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Uploads raw file bytes to an absolute path inside the sandbox. The
body is sent as `application/octet-stream` — the entire request body
is the file contents.

Authentication uses the per-sandbox access token from
`SandboxResponse.access_token`, passed in the `X-Access-Token` header.
This is distinct from the control-plane `X-API-Key`.
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

client.files.upload_file(
    path="/home/user/data.txt",
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

**path:** `str` 

Absolute destination path inside the sandbox. Must start with `/`
and must not contain `..` segments.
    
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

