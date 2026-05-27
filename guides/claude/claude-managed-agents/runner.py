"""In-sandbox tool runner. Started by the orchestrator inside each Superserve sandbox."""
from __future__ import annotations

import asyncio
import logging
import os

from anthropic import AsyncAnthropic

WORKDIR = "/workspace"


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

    environment_key = os.environ["ANTHROPIC_ENVIRONMENT_KEY"]
    max_idle = float(os.environ.get("RUNNER_MAX_IDLE_SECONDS", "300"))

    async with AsyncAnthropic(auth_token=environment_key) as client:
        await client.beta.environments.work.worker(
            environment_key=environment_key,
            workdir=WORKDIR,
            unrestricted_paths=True,
            max_idle=max_idle,
        ).handle_item()


if __name__ == "__main__":
    asyncio.run(main())
