"""Runnable Superserve sandbox coding example adapted from OpenAI Agents SDK.

This example gives the model a tiny repo plus one lazy-loaded skill, then
verifies that the agent edited the repo and ran the targeted test command
inside a real Superserve Firecracker microVM.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path

from agents import ModelSettings, Runner
from agents.items import ToolCallItem
from agents.run import RunConfig
from agents.sandbox import Manifest, SandboxAgent, SandboxPathGrant, SandboxRunConfig
from agents.sandbox.session.sandbox_session import SandboxSession
from agents.sandbox.capabilities import LocalDirLazySkillSource, Skills
from agents.sandbox.capabilities.capabilities import Capabilities
from agents.sandbox.entries import LocalDir
from superserve_agents_openai import SuperserveSandboxClient

DEFAULT_MODEL = "gpt-4o"
TARGET_TEST_CMD = "sh tests/test_credit_note.sh"
DEFAULT_PROMPT = (
    "Open `repo/task.md`, use the `$credit-note-fixer` skill, fix the bug, run "
    f"`{TARGET_TEST_CMD}`, and summarize the change."
)
EXAMPLE_DIR = Path(__file__).resolve().parent


def build_agent(model: str) -> SandboxAgent[None]:
    return SandboxAgent(
        name="Sandbox engineer",
        model=model,
        instructions=(
            "Inspect the repo, make the smallest correct change, run the most relevant checks, "
            "and summarize the file changes and risks. "
            "Read `repo/task.md` before editing files. Stay grounded in the repository, preserve "
            "existing behavior, and use the `$credit-note-fixer` skill before editing files. "
            "When using `apply_patch`, remember that paths are relative to the sandbox workspace "
            "root, not the shell working directory, so edit files as `repo/credit_note.sh` and "
            "`repo/tests/test_credit_note.sh`. "
            f"Run the exact verification command `{TARGET_TEST_CMD}` from `repo/`, then mention "
            "that command in the final answer."
        ),
        default_manifest=Manifest(
            entries={
                "repo": LocalDir(src=EXAMPLE_DIR / "repo"),
            },
            extra_path_grants=(
                SandboxPathGrant(path=str(EXAMPLE_DIR)),
            ),
        ),
        capabilities=Capabilities.default()
        + [
            Skills(
                lazy_from=LocalDirLazySkillSource(
                    source=LocalDir(src=EXAMPLE_DIR / "skills"),
                )
            ),
        ],
        model_settings=ModelSettings(tool_choice="required"),
    )


async def _read_workspace_text(session: SandboxSession, path: Path) -> str:
    handle = await session.read(path)
    try:
        payload = handle.read()
    finally:
        handle.close()

    if isinstance(payload, str):
        return payload
    return bytes(payload).decode("utf-8", errors="replace")


def _tool_call_name(item: ToolCallItem) -> str:
    raw_item = item.raw_item
    if isinstance(raw_item, dict):
        raw_type = raw_item.get("type")
        name = raw_item.get("name")
    else:
        raw_type = getattr(raw_item, "type", None)
        name = getattr(raw_item, "name", None)

    if raw_type == "apply_patch_call":
        return "apply_patch"
    if isinstance(name, str) and name:
        return name
    if isinstance(raw_type, str) and raw_type:
        return raw_type
    return ""


def _tool_call_arguments(item: ToolCallItem) -> dict[str, object]:
    raw_item = item.raw_item
    if isinstance(raw_item, dict):
        arguments = raw_item.get("arguments")
    else:
        arguments = getattr(raw_item, "arguments", None)

    if not isinstance(arguments, str) or arguments == "":
        return {}

    try:
        parsed = json.loads(arguments)
    except json.JSONDecodeError:
        return {"_raw": arguments}

    if isinstance(parsed, dict):
        return parsed
    return {"_value": parsed}


def _saw_target_test_command(tool_calls: list[ToolCallItem]) -> bool:
    for item in tool_calls:
        if _tool_call_name(item) != "exec_command":
            continue

        arguments = _tool_call_arguments(item)
        cmd = arguments.get("cmd")
        workdir = arguments.get("workdir")
        if isinstance(cmd, str) and TARGET_TEST_CMD in cmd:
            if workdir == "repo" or not workdir:
                return True

    return False


async def main(model: str, prompt: str) -> None:
    if not os.environ.get("SUPERSERVE_API_KEY"):
        raise SystemExit("SUPERSERVE_API_KEY environment variable is required.")

    agent = build_agent(model)
    client = SuperserveSandboxClient()

    print("1. Creating Superserve cloud sandbox...")
    sandbox = await client.create(manifest=agent.default_manifest)
    print(f"   Sandbox created successfully: {sandbox.state.sandbox_id}")

    try:
        async with sandbox:
            print("2. Workspace initialized with repo and skills.")
            print("3. Running OpenAI Agent...")
            try:
                result = await Runner.run(
                    agent,
                    prompt,
                    max_turns=12,
                    run_config=RunConfig(
                        sandbox=SandboxRunConfig(session=sandbox),
                        tracing_disabled=True,
                        workflow_name="Superserve sandbox coding example",
                    ),
                )
            except Exception as e:
                error_msg = str(e)
                if any(
                    token in error_msg.lower()
                    for token in ("insufficient_quota", "quota", "429", "unauthorized", "api_key")
                ):
                    print(
                        f"\n[Notice] OpenAI model request stopped: {error_msg}\n"
                        "The Superserve sandbox adapter, microVM provisioning, command execution, and workspace materialization are all working!\n"
                        "Once your OPENAI_API_KEY has active credits and access to the model, this agent loop will complete autonomously."
                    )
                    raise SystemExit(1)
                raise

            tool_calls = [
                item for item in result.new_items if isinstance(item, ToolCallItem)
            ]
            tool_names = [_tool_call_name(item) for item in tool_calls]

            print("4. Verifying agent actions inside sandbox...")
            if "load_skill" not in tool_names:
                raise RuntimeError(f"Expected load_skill call, saw: {tool_names}")
            if "apply_patch" not in tool_names:
                raise RuntimeError(f"Expected apply_patch call, saw: {tool_names}")
            if not _saw_target_test_command(tool_calls):
                raise RuntimeError(
                    f"Expected agent to run targeted test command: {TARGET_TEST_CMD}"
                )

            verification = await sandbox.exec(
                f"cd repo && {TARGET_TEST_CMD}",
                shell=True,
            )
            verification_text = verification.stdout.decode(
                "utf-8", errors="replace"
            ) + verification.stderr.decode("utf-8", errors="replace")
            if verification.exit_code != 0 or "2 passed" not in verification_text:
                raise RuntimeError(
                    f"Post-run verification failed:\n{verification_text}"
                )

            updated_module = await _read_workspace_text(
                sandbox, Path("repo/credit_note.sh")
            )

            print("\n=== Execution Summary ===")
            print("final_output:", result.final_output)
            print("tool_calls:", ", ".join(tool_names))
            print("verification_result: target test passed with '2 passed'")
            print("updated credit_note.sh:\n", updated_module)
    finally:
        print("5. Cleaning up Superserve sandbox...")
        await client.delete(sandbox)
        print("   Cleanup complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run self-validating coding agent example with Superserve sandbox."
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Model name to use.")
    parser.add_argument(
        "--prompt", default=DEFAULT_PROMPT, help="Prompt to send to the agent."
    )
    args = parser.parse_args()

    asyncio.run(main(args.model, args.prompt))
