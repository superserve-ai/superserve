"""Polling orchestrator for Claude Managed Agents on Superserve."""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import threading
import time
from pathlib import Path

import dotenv
from anthropic import AsyncAnthropic
from superserve import AsyncSandbox, NetworkConfig

dotenv.load_dotenv(override=True)

ENVIRONMENT_KEY = os.environ["ANTHROPIC_ENVIRONMENT_KEY"]
ENVIRONMENT_ID = os.environ["ANTHROPIC_ENVIRONMENT_ID"]
TEMPLATE_NAME = os.environ.get("TEMPLATE_NAME", "claude-managed-agent")
IDLE_PAUSE_SECONDS = float(os.environ.get("IDLE_PAUSE_SECONDS", "300"))
POLL_BLOCK_MS = int(os.environ.get("POLL_BLOCK_MS", "999"))
POLL_RECLAIM_OLDER_THAN_MS = int(os.environ.get("POLL_RECLAIM_OLDER_THAN_MS", "2000"))

RUNNER = Path(__file__).with_name("runner.py").read_text()

log = logging.getLogger("orchestrator")
shutdown = threading.Event()


async def find_or_create_sandbox(session_id: str) -> AsyncSandbox:
    existing = await AsyncSandbox.list(metadata={"cma.session_id": session_id})
    live = [s for s in existing if s.status in ("active", "paused")]

    if live:
        sandbox = await AsyncSandbox.connect(live[0].id)
        if live[0].status == "paused":
            log.info("resuming paused sandbox for session=%s", session_id)
            await sandbox.resume()
        return sandbox

    log.info("creating sandbox for session=%s", session_id)
    return await AsyncSandbox.create(
        name=f"cma-{session_id[:8]}",
        from_template=TEMPLATE_NAME,
        metadata={"cma.session_id": session_id},
        network=NetworkConfig(
            allow_out=["api.anthropic.com"],
            deny_out=["0.0.0.0/0"],
        ),
    )


async def handle_work(work) -> None:
    session_id = work.data.id
    log.info("claimed work=%s session=%s", work.id, session_id)

    sandbox = await find_or_create_sandbox(session_id)
    await sandbox.files.write("/workspace/runner.py", RUNNER)
    await sandbox.commands.run(
        "nohup python3 /workspace/runner.py > /workspace/runner.log 2>&1 &",
        env={
            "ANTHROPIC_ENVIRONMENT_KEY": ENVIRONMENT_KEY,
            "ANTHROPIC_WORK_ID": work.id,
            "ANTHROPIC_SESSION_ID": session_id,
            "ANTHROPIC_ENVIRONMENT_ID": ENVIRONMENT_ID,
        },
    )
    log.info("runner started in sandbox=%s for session=%s", sandbox.id, session_id)


async def janitor_loop() -> None:
    while not shutdown.is_set():
        await asyncio.sleep(IDLE_PAUSE_SECONDS)
        try:
            sandboxes = await AsyncSandbox.list()
            for s in sandboxes:
                if s.status != "active":
                    continue
                meta = s.metadata or {}
                if not meta.get("cma.session_id"):
                    continue
                age = (asyncio.get_event_loop().time())
                sandbox = await AsyncSandbox.connect(s.id)
                info = await sandbox.get_info()
                if info.status == "active":
                    log.info("pausing idle sandbox=%s session=%s", s.id, meta.get("cma.session_id"))
                    await sandbox.pause()
        except Exception as e:
            log.warning("janitor error: %s", e)


async def poll_loop() -> None:
    async with AsyncAnthropic(auth_token=ENVIRONMENT_KEY) as client:
        log.info(
            "polling env=%s template=%s block_ms=%d",
            ENVIRONMENT_ID, TEMPLATE_NAME, POLL_BLOCK_MS,
        )
        async for work in client.beta.environments.work.poller(
            environment_id=ENVIRONMENT_ID,
            environment_key=ENVIRONMENT_KEY,
            block_ms=POLL_BLOCK_MS,
            reclaim_older_than_ms=POLL_RECLAIM_OLDER_THAN_MS,
            auto_stop=False,
        ):
            try:
                await handle_work(work)
            except Exception as e:
                log.error("failed to handle work=%s: %s", work.id, e, exc_info=True)


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    def request_shutdown(signum, _frame):
        log.info("shutdown requested (signal %d)", signum)
        shutdown.set()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)

    asyncio.run(poll_loop())


if __name__ == "__main__":
    main()
