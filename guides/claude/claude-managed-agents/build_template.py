"""Build the Superserve template for Claude Managed Agents sandboxes."""
from __future__ import annotations

import sys

import dotenv
from superserve import Template, RunStep, WorkdirStep
from superserve.errors import ConflictError

dotenv.load_dotenv(override=True)

TEMPLATE_NAME = "claude-managed-agent"

STEPS = [
    RunStep(run=(
        "apt-get update && apt-get install -y --no-install-recommends "
        "curl git jq procps && rm -rf /var/lib/apt/lists/*"
    )),
    RunStep(run="pip install --no-cache-dir anthropic"),
    RunStep(run="mkdir -p /workspace /mnt/session/outputs"),
    WorkdirStep(workdir="/workspace"),
]


def main() -> int:
    existing = [t for t in Template.list() if t.name == TEMPLATE_NAME]
    if existing and existing[0].status.value == "ready":
        print(f"template {TEMPLATE_NAME!r} already exists and is ready (id: {existing[0].id})")
        return 0

    print(f"creating template {TEMPLATE_NAME!r}...")
    template = Template.create(
        name=TEMPLATE_NAME,
        from_="python:3.12-slim",
        vcpu=2,
        memory_mib=2048,
        steps=STEPS,
    )
    print(f"template created (id: {template.id}), waiting for build...")

    template.wait_until_ready(
        on_log=lambda ev: print(ev.text, end="", flush=True)
        if ev.stream.value != "system"
        else None,
    )

    print(f"\ntemplate {TEMPLATE_NAME!r} is ready (id: {template.id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
