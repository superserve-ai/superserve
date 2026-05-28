"""Webhook orchestrator for Claude Managed Agents on Superserve."""
from __future__ import annotations

import asyncio
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
WEBHOOK_SECRET = os.environ["ANTHROPIC_WEBHOOK_SECRET"]

log = logging.getLogger("orchestrator.webhook")
app = FastAPI()

_client = anthropic.Anthropic(auth_token=orchestrator.ENVIRONMENT_KEY)
_drain_lock = threading.Lock()


def _drain_work() -> None:
    if not _drain_lock.acquire(blocking=False):
        log.debug("drain already in progress, skipping")
        return
    try:
        asyncio.run(_drain_work_async())
    finally:
        _drain_lock.release()


async def _drain_work_async() -> None:
    async with anthropic.AsyncAnthropic(auth_token=orchestrator.ENVIRONMENT_KEY) as client:
        async for work in client.beta.environments.work.poller(
            environment_id=orchestrator.ENVIRONMENT_ID,
            environment_key=orchestrator.ENVIRONMENT_KEY,
            block_ms=None,
            reclaim_older_than_ms=2000,
            drain=True,
            auto_stop=False,
        ):
            try:
                await orchestrator.handle_work(work)
            except Exception as e:
                log.error("failed work=%s: %s", work.id, e, exc_info=True)


def _fallback_drain_loop() -> None:
    while True:
        try:
            _drain_work()
        except Exception as e:
            log.warning("fallback drain error: %s", e)
        orchestrator.shutdown_thread.wait(30)
        if orchestrator.shutdown_thread.is_set():
            return


@app.post("/")
async def webhook(request: Request, background_tasks: BackgroundTasks):
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


@app.on_event("startup")
def on_startup() -> None:
    orchestrator.acquire_lock()
    threading.Thread(target=_fallback_drain_loop, daemon=True).start()
    log.info("webhook orchestrator listening on :%d env=%s", PORT, orchestrator.ENVIRONMENT_ID)


@app.on_event("shutdown")
def on_shutdown() -> None:
    orchestrator.shutdown_thread.set()


def main() -> None:
    logging.basicConfig(
        level="INFO",
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")


if __name__ == "__main__":
    main()
