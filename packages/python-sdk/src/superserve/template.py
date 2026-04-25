"""Sync Template class — reusable sandbox base image with build steps.

```python
from superserve import Template, Sandbox

template = Template.create(
    alias="my-python-env",
    from_="python:3.11",
    steps=[{"run": "pip install numpy"}],
)
template.wait_until_ready()
sandbox = Sandbox.create(name="run-1", from_template=template)
```
"""
from __future__ import annotations

import builtins
from typing import Any, Callable
from urllib.parse import urlencode

from ._config import ResolvedConfig, resolve_config
from ._http import api_request, stream_sse
from .errors import BuildError, ConflictError, NotFoundError, SandboxError
from .types import (
    BuildLogEvent,
    BuildStep,
    TemplateBuildInfo,
    TemplateInfo,
    TemplateStatus,
    build_steps_to_api,
    to_build_log_event,
    to_template_build_info,
    to_template_info,
)


class Template:
    """A template — call static factories (`create`, `connect`, `list`)."""

    def __init__(self, info: TemplateInfo, config: ResolvedConfig) -> None:
        self.id: str = info.id
        self.alias: str = info.alias
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
    def create(
        cls,
        *,
        alias: str,
        from_: str,
        vcpu: int | None = None,
        memory_mib: int | None = None,
        disk_mib: int | None = None,
        steps: list[BuildStep] | None = None,
        start_cmd: str | None = None,
        ready_cmd: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> Template:
        """Create a template and kick off the first build."""
        config = resolve_config(api_key=api_key, base_url=base_url)

        build_spec: dict[str, Any] = {"from": from_}
        if steps is not None:
            build_spec["steps"] = build_steps_to_api(steps)
        if start_cmd is not None:
            build_spec["start_cmd"] = start_cmd
        if ready_cmd is not None:
            build_spec["ready_cmd"] = ready_cmd

        body: dict[str, Any] = {"alias": alias, "build_spec": build_spec}
        if vcpu is not None:
            body["vcpu"] = vcpu
        if memory_mib is not None:
            body["memory_mib"] = memory_mib
        if disk_mib is not None:
            body["disk_mib"] = disk_mib

        raw = api_request(
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
    def connect(
        cls,
        alias_or_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> Template:
        """Connect to an existing template by alias or ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "GET",
            f"{config.base_url}/templates/{alias_or_id}",
            headers={"X-API-Key": config.api_key},
        )
        return cls(to_template_info(raw), config)

    @classmethod
    def list(
        cls,
        *,
        alias_prefix: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> builtins.list[TemplateInfo]:
        """List all templates visible to the authenticated team."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        url = f"{config.base_url}/templates"
        if alias_prefix:
            url += "?" + urlencode({"alias_prefix": alias_prefix})
        raw = api_request(
            "GET",
            url,
            headers={"X-API-Key": config.api_key},
        )
        return [to_template_info(t) for t in raw]

    @classmethod
    def delete_by_id(
        cls,
        alias_or_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        """Delete a template by alias or ID. Idempotent on 404."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        try:
            api_request(
                "DELETE",
                f"{config.base_url}/templates/{alias_or_id}",
                headers={"X-API-Key": config.api_key},
            )
        except NotFoundError:
            pass

    # ------------------------------------------------------------------
    # Instance methods
    # ------------------------------------------------------------------

    def get_info(self) -> TemplateInfo:
        """Refresh this template's info from the API."""
        raw = api_request(
            "GET",
            f"{self._config.base_url}/templates/{self.id}",
            headers={"X-API-Key": self._config.api_key},
        )
        return to_template_info(raw)

    def delete(self) -> None:
        """Delete this template. Idempotent on 404.

        Raises ``ConflictError`` if sandboxes reference it.
        """
        try:
            api_request(
                "DELETE",
                f"{self._config.base_url}/templates/{self.id}",
                headers={"X-API-Key": self._config.api_key},
            )
        except NotFoundError:
            pass

    def rebuild(self) -> TemplateBuildInfo:
        """Queue a new build for this template. Idempotent on spec hash."""
        raw = api_request(
            "POST",
            f"{self._config.base_url}/templates/{self.id}/builds",
            headers={"X-API-Key": self._config.api_key},
        )
        return to_template_build_info(raw)

    def list_builds(
        self, *, limit: int | None = None
    ) -> builtins.list[TemplateBuildInfo]:
        """List recent builds for this template."""
        url = f"{self._config.base_url}/templates/{self.id}/builds"
        if limit is not None:
            url += f"?limit={limit}"
        raw = api_request(
            "GET",
            url,
            headers={"X-API-Key": self._config.api_key},
        )
        return [to_template_build_info(b) for b in raw]

    def get_build(self, build_id: str) -> TemplateBuildInfo:
        """Get a build by ID."""
        raw = api_request(
            "GET",
            f"{self._config.base_url}/templates/{self.id}/builds/{build_id}",
            headers={"X-API-Key": self._config.api_key},
        )
        return to_template_build_info(raw)

    def cancel_build(self, build_id: str) -> None:
        """Cancel an in-flight build. Idempotent."""
        try:
            api_request(
                "DELETE",
                f"{self._config.base_url}/templates/{self.id}/builds/{build_id}",
                headers={"X-API-Key": self._config.api_key},
            )
        except NotFoundError:
            pass

    def _resolve_build_id(self, build_id: str | None = None) -> str:
        """Resolve the build to operate on.

        Order: explicit ``build_id`` > ``self.latest_build_id`` (set on create) >
        most recent build via ``list_builds``. Raises if the template has no
        builds.
        """
        if build_id:
            return build_id
        if self.latest_build_id:
            return self.latest_build_id
        recent = self.list_builds(limit=1)
        if not recent:
            raise SandboxError(
                f"Template {self.alias} has no builds — call rebuild() first"
            )
        return recent[0].id

    def stream_build_logs(
        self,
        *,
        on_event: Callable[[BuildLogEvent], None],
        build_id: str | None = None,
    ) -> None:
        """Stream build logs for this template (SSE)."""
        bid = self._resolve_build_id(build_id)

        def _adapter(raw: dict[str, Any]) -> None:
            on_event(to_build_log_event(raw))

        stream_sse(
            f"{self._config.base_url}/templates/{self.id}/builds/{bid}/logs",
            headers={"X-API-Key": self._config.api_key},
            json_body=None,
            method="GET",
            on_event=_adapter,
        )

    def wait_until_ready(
        self,
        *,
        on_log: Callable[[BuildLogEvent], None] | None = None,
        poll_interval_s: float = 2.0,
    ) -> TemplateInfo:
        """Block until the current build reaches terminal status.

        Attempts SSE first; falls back to polling on SSE error. Raises
        `BuildError` on `failed` or `ConflictError` on `cancelled`.
        """
        import re
        import time as _time

        final_status: str | None = None
        # Try to resolve a build to follow. If template has no builds, fall
        # through to polling status only (no log stream).
        try:
            bid: str | None = self._resolve_build_id()
        except SandboxError:
            bid = None

        if bid:
            def _on_raw(raw: dict[str, Any]) -> None:
                nonlocal final_status
                ev = to_build_log_event(raw)
                if on_log:
                    on_log(ev)
                if ev.finished and ev.status:
                    final_status = ev.status

            try:
                stream_sse(
                    f"{self._config.base_url}/templates/{self.id}/builds/{bid}/logs",
                    headers={"X-API-Key": self._config.api_key},
                    json_body=None,
                    method="GET",
                    on_event=_on_raw,
                )
            except Exception:
                # Fall through to polling.
                pass

        while final_status is None:
            info = self.get_info()
            if info.status in (TemplateStatus.READY, TemplateStatus.FAILED):
                final_status = info.status.value
                break
            _time.sleep(poll_interval_s)

        info = self.get_info()
        if final_status == "ready":
            return info
        if final_status == "cancelled":
            raise ConflictError("template build was cancelled", code="cancelled")

        msg = info.error_message or "build_failed"
        match = re.match(r"^(\w+):", msg)
        code = match.group(1) if match else "build_failed"
        raise BuildError(msg, code=code, build_id=bid or "", template_id=self.id)

    def __repr__(self) -> str:
        return (
            f"Template(id={self.id!r}, alias={self.alias!r}, "
            f"status={self.status.value!r})"
        )
