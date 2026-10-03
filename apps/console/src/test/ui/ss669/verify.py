"""Render production billing pages over isolated local service fixtures."""

import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import urlopen

try:
    from playwright.sync_api import expect, sync_playwright
except ImportError:
    raise SystemExit(
        "Playwright is required. Install it in a Python virtual environment, run "
        "python -m playwright install chromium, then set UI_TEST_PYTHON to that Python."
    )

APP = Path(__file__).resolve().parents[4]
SCENARIOS = ("tracked", "zero", "paid", "credited")


def health(base):
    with urlopen(base + "/api/fixture-health/", timeout=2) as response:
        return json.load(response) == {"fixture": "ss669-storage-billing"}


@contextmanager
def server(base):
    if base:
        parts = urlsplit(base)
        if parts.scheme != "http" or parts.hostname not in ("127.0.0.1", "localhost") or parts.path not in ("", "/"):
            raise ValueError("Only a local HTTP fixture origin is supported")
        base = base.rstrip("/")
        if not health(base):
            raise RuntimeError("The selected server is not the SS-669 fixture")
        yield base
        return

    base = "http://127.0.0.1:4174"
    with tempfile.TemporaryFile(mode="w+") as log:
        process = subprocess.Popen(
            ["bun", "run", "dev:storage-ui"], cwd=APP,
            stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
        try:
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    log.seek(0)
                    raise RuntimeError("Fixture server failed to start:\n" + log.read()[-4000:])
                try:
                    if health(base):
                        # Do not silently reuse another server when our bind failed.
                        process.wait(timeout=0.2)
                        raise RuntimeError("Fixture port is already in use; use --base-url to select it explicitly")
                except subprocess.TimeoutExpired:
                    break
                except (URLError, TimeoutError):
                    time.sleep(0.2)
            else:
                raise RuntimeError("Timed out starting the local billing fixture")
            yield base
        finally:
            # Terminate only this test's process group, including Next's child.
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()


def verify(browser, base, scenario, output):
    context = browser.new_context(
        viewport={"width": 1280, "height": 1000}, timezone_id="UTC",
        service_workers="block",
    )
    errors = []
    requests = set()
    summaries = []

    def guard(route):
        url = urlsplit(route.request.url)
        if f"{url.scheme}://{url.netloc}" != base:
            errors.append(f"Unexpected external request: {url.scheme}://{url.netloc}")
            route.abort()
        else:
            route.continue_()

    context.route("**/*", guard)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)

    def response_seen(response):
        path = urlsplit(response.url).path
        if path.startswith("/api/"):
            requests.add(path)
            if response.status >= 400:
                errors.append(f"{response.status} {path}")
            if path == "/api/billing/summary/" and response.ok:
                summaries.append(response.json())

    page.on("response", response_seen)
    try:
        # Missing setup must fail rather than silently choosing a billing state.
        assert context.request.get(base + "/api/billing/summary/").status == 400
        response = page.goto(f"{base}/settings/?scenario={scenario}", wait_until="networkidle")
        assert response.status == 200
        assert urlsplit(page.url).path == "/settings/", page.url
        storage_rate = page.locator("dl > div").filter(has=page.locator("dt", has_text="Storage"))
        expect(storage_rate).to_contain_text("$0.000108 / GiB-hour")
        expect(storage_rate).to_contain_text("Tracked only · Not billed" if scenario == "tracked" else "Billed")
        if scenario != "tracked":
            expect(storage_rate).not_to_contain_text("Not billed")
        expect(page.get_by_text("$0.0720 / vCPU-hour", exact=True)).to_be_visible()
        expect(page.get_by_text("$0.0144 / GiB-hour", exact=True)).to_be_visible()
        settings_summary = summaries[-1]
        page.screenshot(path=str(output / f"settings-{scenario}.png"), full_page=True)

        # The production link drops the fixture query; local session setup must persist.
        page.get_by_role("link", name="Billing & Usage", exact=True).click()
        page.wait_for_url("**/plan-usage/")
        card = page.locator("div.border-dashed.px-3.py-3").filter(has=page.get_by_text("Storage", exact=True))
        expect(card).to_have_count(1)
        charge = "$1.25" if scenario in ("paid", "credited") else "$0.00"
        expect(card).to_contain_text("Tracked but not billed" if scenario == "tracked" else f"Charge: {charge}")
        expect(card.get_by_text("Tracked only" if scenario == "tracked" else "Billed", exact=True)).to_be_visible()
        card.scroll_into_view_if_needed()
        page.screenshot(path=str(output / f"usage-resources-{scenario}.png"), full_page=True)
        legend = page.get_by_label("Chart legend", exact=True)
        expect(legend).to_contain_text("Storage equivalent (not billed)" if scenario == "tracked" else "Storage")
        if scenario != "tracked":
            expect(page.get_by_text("Tracked but not billed", exact=True)).to_have_count(0)
            expect(legend).not_to_contain_text("not billed")
        chart = page.get_by_label("Usage cost chart", exact=True)
        buckets = chart.locator("button[aria-label]")
        expect(buckets).to_have_count(2)
        before = "Storage $0.63 (not billed)" if scenario == "tracked" else "Storage $0.00"
        after = "Storage $0.63 (not billed)" if scenario == "tracked" else f"Storage {charge}"
        expect(buckets.first).to_have_attribute("aria-label", re.compile(re.escape(before)))
        expect(buckets.last).to_have_attribute("aria-label", re.compile(re.escape(after)))
        expect(buckets.first).to_have_attribute("aria-label", re.compile(r"Billed total \$1\.80"))
        total = "3.05" if scenario in ("paid", "credited") else "1.80"
        expect(buckets.last).to_have_attribute("aria-label", re.compile(re.escape(f"Billed total ${total}")))
        buckets.last.hover()
        expect(page.locator(".ss-tooltip-popup")).to_contain_text(after)
        page.mouse.move(0, 0)
        chart.scroll_into_view_if_needed()
        page.screenshot(path=str(output / f"usage-{scenario}.png"), full_page=True)

        assert settings_summary == summaries[-1], "Pages received different summary fixtures"
        storage = next(r for r in settings_summary["resources"] if r["resource_key"] == "storage_gib")
        assert storage["billable"] == (scenario != "tracked")
        if scenario == "credited":
            assert storage["charge_usd"] > 0
            assert settings_summary["expected_invoice_amount_usd"] == 0
            assert settings_summary["credits_applied_usd"] == settings_summary["current_charges_usd"]
        assert {"/api/billing/pricing/", "/api/billing/summary/", "/api/billing/usage-series/"} <= requests
        assert context.request.post(base + "/api/stripe/checkout-session/").status == 405
        assert not errors, errors
        assert not page.locator("[data-nextjs-dialog], .vite-error-overlay").count()
        print(f"PASS {scenario}: Settings → Plan & Usage, storage card, rate, chart and tooltip", flush=True)
    except Exception:
        print(f"FAIL {scenario}: url={page.url}; browser_errors={errors}", flush=True)
        page.screenshot(path=str(output / f"failure-{scenario}.png"), full_page=True)
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", help="Reuse an explicitly selected local SS-669 fixture server")
    parser.add_argument("--output", type=Path, default=Path(tempfile.mkdtemp(prefix="ss669-browser-")))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with server(args.base_url) as base, sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            for scenario in SCENARIOS:
                verify(browser, base, scenario, args.output)
        finally:
            browser.close()
    print(f"PASS: 8 billing page states. Screenshots: {args.output}")


if __name__ == "__main__":
    main()
