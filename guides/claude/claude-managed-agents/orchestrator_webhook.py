"""Webhook orchestrator for Claude Managed Agents on Superserve."""
from __future__ import annotations

import logging
import os
import threading

import anthropic
import dotenv
import uvicorn
from fastapi import BackgroundTasks, HTTPException, Request, FastAPI

import orchestrator

dotenv.load_dotenv(override=True)

PORT = int(os.environ.get("PORT", "5051"))
WEBHOOK_SECRET = os.environ.get("ANTHROPIC_WEBHOOK_SECRET")

log = logging.getLogger("orchestrator.webhook")
app = FastAPI()

_client = anthropic.Anthropic(auth_token=orchestrator.ENVIRONMENT_KEY)


def _drain_work() -> None:
    import asyncio
    asyncio.run(_drain_work_async())


async def _drain_work_async() -> None:
    async with anthropic.AsyncAnthropic(auth_token=orchestrator.ENVIRONMENT_KEY) as client:
        async for work in client.beta.environments.work.poller(
            environment_id=orchestrator.ENVIRONMENT_ID,
            environment_key=orchestrator.ENVIRONMENT_KEY,
            block_ms=None,
            reclaim_older_than_ms=int(os.environ.get("POLL_RECLAIM_OLDER_THAN_MS", "2000")),
            drain=True,
            auto_stop=False,
        ):
            try:
                await orchestrator.handle_work(work)
            except Exception as e:
                log.error("failed to handle work=%s: %s", work.id, e, exc_info=True)


@app.post("/")
async def webhook(request: Request, background_tasks: BackgroundTasks):
    if WEBHOOK_SECRET is None:
        raise HTTPException(status_code=500, detail="ANTHROPIC_WEBHOOK_SECRET not set")

    raw = await request.body()
    try:
        event = _client.beta.webhooks.unwrap(
            raw.decode(),
            headers=dict(request.headers),
            key=WEBHOOK_SECRET,
        )
    except anthropic.APIWebhookValidationError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e

    if event.data.type != "session.status_run_started":
        return {"status": "ignored"}

    background_tasks.add_task(_drain_work)
    return {"status": "queued"}


@app.get("/healthz")
def healthz():
    return {"ok": True, "environment_id": orchestrator.ENVIRONMENT_ID}


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    if WEBHOOK_SECRET is None:
        raise RuntimeError(
            "ANTHROPIC_WEBHOOK_SECRET is not set. "
            "Use orchestrator.py for polling mode, or set the secret for webhook mode."
        )
    log.info("webhook orchestrator listening on :%d env=%s", PORT, orchestrator.ENVIRONMENT_ID)
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")


if __name__ == "__main__":
    main()
