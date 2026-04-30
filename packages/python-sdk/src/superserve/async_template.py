"""Async Template class — reusable sandbox base image with build steps.

```python
import asyncio
from superserve import AsyncTemplate, AsyncSandbox


async def main() -> None:
    template = await AsyncTemplate.create(
        name="my-python-env",
        from_="python:3.11",
        steps=[{"run": "pip install numpy"}],
    )
    await template.wait_until_ready()
    sandbox = await AsyncSandbox.create(name="run-1", from_template=template)

asyncio.run(main())
```
"""

from __future__ import annotations

import asyncio
import builtins
from typing import Any, Callable
from urllib.parse import urlencode

from ._config import ResolvedConfig, resolve_config
from ._http import async_api_request, async_stream_sse
from .errors import BuildError, ConflictError, NotFoundError, SandboxError
from .types import (
    BuildLogEvent,
    BuildStep,
    TemplateBuildInfo,
    TemplateBuildStatus,
    TemplateInfo,
    TemplateStatus,
    build_steps_to_api,
    to_build_log_event,
    to_template_build_info,
    to_template_info,
)


class AsyncTemplate:
    """Async variant of Template with identical API surface."""

    def __init__(self, info: TemplateInfo, config: ResolvedConfig) -> None:
        self.id: str = info.id
        self.name: str = info.name
        self.team_id: str = info.team_id
        self.status: TemplateStatus = info.status
        self.vcpu: int = info.vcpu
        self.memory_mib: int = info.memory_mib
        self.disk_mib: int = info.disk_mib
        self.size_bytes = info.size_bytes
        self.error_message = info.error_message
        self.created_at = info.created_at
        self.built_at = info.built_at
        self.latest_build_id = info.latest_build_id
        self._config = config

    # ------------------------------------------------------------------
    # Static factories
    # ------------------------------------------------------------------

    @classmethod
    async def create(
        cls,
        *,
        name: str,
        from_: str,
        vcpu: int | None = None,
        memory_mib: int | None = None,
        disk_mib: int | None = None,
        steps: list[BuildStep] | None = None,
        start_cmd: str | None = None,
        ready_cmd: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> AsyncTemplate:
        """Create a template and kick off the first build."""
        config = resolve_config(api_key=api_key, base_url=base_url)

        build_spec: dict[str, Any] = {"from": from_}
        if steps is not None:
            build_spec["steps"] = build_steps_to_api(steps)
        if start_cmd is not None:
            build_spec["start_cmd"] = start_cmd
        if ready_cmd is not None:
            build_spec["ready_cmd"] = ready_cmd

        body: dict[str, Any] = {"name": name, "build_spec": build_spec}
        if vcpu is not None:
            body["vcpu"] = vcpu
        if memory_mib is not None:
            body["memory_mib"] = memory_mib
        if disk_mib is not None:
            body["disk_mib"] = disk_mib

        raw = await async_api_request(
            "POST",
            f"{config.base_url}/templates",
            headers={"X-API-Key": config.api_key},
            json_body=body,
        )
        build_id = raw.get("build_id") if raw else None
        if not build_id:
            raise SandboxError(
                "Invalid API response from POST /templates: missing build_id"
            )
        return cls(to_template_info(raw, build_id), config)

    @classmethod
    async def connect(
        cls,
        name_or_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> AsyncTemplate:
        """Connect to an existing template by name or ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/templates/{name_or_id}",
            headers={"X-API-Key": config.api_key},
        )
        return cls(to_template_info(raw), config)

    @classmethod
    async def list(
        cls,
        *,
        name_prefix: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> builtins.list[TemplateInfo]:
        """List all templates visible to the authenticated team."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        url = f"{config.base_url}/templates"
        if name_prefix:
            url += "?" + urlencode({"name_prefix": name_prefix})
        raw = await async_api_request(
            "GET",
            url,
            headers={"X-API-Key": config.api_key},
        )
        return [to_template_info(t) for t in raw]

    @classmethod
    async def delete_by_id(
        cls,
        name_or_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        """Delete a template by name or ID. Idempotent on 404."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        try:
            await async_api_request(
                "DELETE",
                f"{config.base_url}/templates/{name_or_id}",
                headers={"X-API-Key": config.api_key},
            )
        except NotFoundError:
            pass

    # ------------------------------------------------------------------
    # Instance methods
    # ------------------------------------------------------------------

    async def get_info(self) -> TemplateInfo:
        """Refresh this template's info from the API."""
        raw = await async_api_request(
            "GET",
            f"{self._config.base_url}/templates/{self.id}",
            headers={"X-API-Key": self._config.api_key},
        )
        return to_template_info(raw)

    async def delete(self) -> None:
        """Delete this template. Idempotent on 404.

        Raises ``ConflictError`` if sandboxes reference it.
        """
        try:
            await async_api_request(
                "DELETE",
                f"{self._config.base_url}/templates/{self.id}",
                headers={"X-API-Key": self._config.api_key},
            )
        except NotFoundError:
            pass

    async def rebuild(self) -> TemplateBuildInfo:
        """Queue a new build for this template. Idempotent on spec hash."""
        raw = await async_api_request(
            "POST",
            f"{self._config.base_url}/templates/{self.id}/builds",
            headers={"X-API-Key": self._config.api_key},
        )
        return to_template_build_info(raw)

    async def list_builds(
        self, *, limit: int | None = None
    ) -> builtins.list[TemplateBuildInfo]:
        """List recent builds for this template."""
        url = f"{self._config.base_url}/templates/{self.id}/builds"
        if limit is not None:
            url += f"?limit={limit}"
        raw = await async_api_request(
            "GET",
            url,
            headers={"X-API-Key": self._config.api_key},
        )
        return [to_template_build_info(b) for b in raw]

    async def get_build(self, build_id: str) -> TemplateBuildInfo:
        """Get a build by ID."""
        raw = await async_api_request(
            "GET",
            f"{self._config.base_url}/templates/{self.id}/builds/{build_id}",
            headers={"X-API-Key": self._config.api_key},
        )
        return to_template_build_info(raw)

    async def cancel_build(self, build_id: str) -> None:
        """Cancel an in-flight build. Idempotent."""
        try:
            await async_api_request(
                "DELETE",
                f"{self._config.base_url}/templates/{self.id}/builds/{build_id}",
                headers={"X-API-Key": self._config.api_key},
            )
        except NotFoundError:
            pass

    async def _resolve_build_id(self, build_id: str | None = None) -> str:
        """Resolve the build to operate on.

        Order: explicit ``build_id`` > ``self.latest_build_id`` (set on create) >
        most recent build via ``list_builds``. Raises if the template has no
        builds.
        """
        if build_id:
            return build_id
        if self.latest_build_id:
            return self.latest_build_id
        recent = await self.list_builds(limit=1)
        if not recent:
            raise SandboxError(
                f"Template {self.name} has no builds — call rebuild() first"
            )
        return recent[0].id

    async def stream_build_logs(
        self,
        *,
        on_event: Callable[[BuildLogEvent], None],
        build_id: str | None = None,
    ) -> None:
        """Stream build logs for this template (SSE)."""
        bid = await self._resolve_build_id(build_id)

        def _adapter(raw: dict[str, Any]) -> None:
            on_event(to_build_log_event(raw))

        await async_stream_sse(
            f"{self._config.base_url}/templates/{self.id}/builds/{bid}/logs",
            headers={"X-API-Key": self._config.api_key},
            json_body=None,
            method="GET",
            on_event=_adapter,
        )

    async def wait_until_ready(
        self,
        *,
        on_log: Callable[[BuildLogEvent], None] | None = None,
        poll_interval_s: float = 2.0,
    ) -> TemplateInfo:
        """Block until the current build reaches terminal status.

        Polls ``GET /templates/{id}/builds/{bid}`` (the DB-backed build row)
        as the source of truth — SSE is only used for live log delivery
        when ``on_log`` is provided. Raises ``BuildError`` on ``failed``
        or ``ConflictError`` on ``cancelled``.
        """
        import re

        try:
            bid: str | None = await self._resolve_build_id()
        except SandboxError:
            bid = None

        # SSE for live logs — best effort, runs concurrently with the poll
        # loop. The server emits `finished:true, status:"ready"` the instant
        # vmd finishes, but the DB row that POST /sandboxes reads is updated
        # by a separate ~1s poller. Treating SSE as the terminal signal
        # would race that update and leave callers seeing 409 "template is
        # not ready" on the very next request. Build poll is source of truth.
        sse_task: asyncio.Task[None] | None = None
        if bid and on_log is not None:

            def _on_raw(raw: dict[str, Any]) -> None:
                on_log(to_build_log_event(raw))

            async def _run_sse(build_id: str) -> None:
                try:
                    await async_stream_sse(
                        f"{self._config.base_url}/templates/{self.id}/builds/{build_id}/logs",
                        headers={"X-API-Key": self._config.api_key},
                        json_body=None,
                        method="GET",
                        on_event=_on_raw,
                    )
                except Exception:
                    # SSE failures are non-fatal — polling drives detection.
                    pass

            sse_task = asyncio.create_task(_run_sse(bid))

        # Split a backend `error_message` of the form `"<code>: <detail>"`
        # into a stable code and a clean human-readable message.
        def _parse_err(msg: str | None) -> tuple[str, str]:
            if not msg:
                return "build_failed", "Template build failed"
            match = re.match(r"^(\w+):\s*(.*)$", msg, re.DOTALL)
            if match and match.group(2).strip():
                return match.group(1), match.group(2).strip()
            return "build_failed", msg

        try:
            if bid:
                # Build status transitions pending → building → snapshotting →
                # ready/failed/cancelled. Template-level status reflects the
                # *latest successful* build, so polling /templates/{id} would
                # say "ready" instantly when rebuilding an already-ready
                # template. The build-level row is what we need.
                while True:
                    build = await self.get_build(bid)
                    if build.status == TemplateBuildStatus.READY:
                        return await self.get_info()
                    if build.status == TemplateBuildStatus.FAILED:
                        code, msg = _parse_err(build.error_message)
                        raise BuildError(
                            msg, code=code, build_id=bid, template_id=self.id
                        )
                    if build.status == TemplateBuildStatus.CANCELLED:
                        raise ConflictError(
                            "template build was cancelled", code="cancelled"
                        )
                    await asyncio.sleep(poll_interval_s)

            # No build_id — rare path; poll template status as a best effort.
            while True:
                info = await self.get_info()
                if info.status == TemplateStatus.READY:
                    return info
                if info.status == TemplateStatus.FAILED:
                    code, msg = _parse_err(info.error_message)
                    raise BuildError(
                        msg, code=code, build_id="", template_id=self.id
                    )
                await asyncio.sleep(poll_interval_s)
        finally:
            if sse_task is not None and not sse_task.done():
                sse_task.cancel()
                try:
                    await sse_task
                except (asyncio.CancelledError, Exception):
                    pass

    def __repr__(self) -> str:
        return (
            f"AsyncTemplate(id={self.id!r}, name={self.name!r}, "
            f"status={self.status.value!r})"
        )
