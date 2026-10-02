"""Exercise real login inputs and navigation against the isolated local fixture."""
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for iteration in range(3):
            context = browser.new_context(service_workers="block")
            blocked, errors = [], []

            def route(request):
                url = urlsplit(request.request.url)
                if (url.scheme, url.netloc) == ("http", "127.0.0.1:4173"):
                    request.continue_()
                else:
                    blocked.append(request.request.url)
                    request.abort()

            context.route("**/*", route)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(
                "http://127.0.0.1:4173/auth/signin/"
                "?next=/sandboxes&ui_case=ss640-existing-email-login",
                wait_until="networkidle",
                timeout=60000,
            )
            expect(page.get_by_placeholder("Email")).to_have_value("")
            page.get_by_placeholder("Email").fill("fixture@example.test")
            page.get_by_placeholder("Password", exact=True).fill("synthetic-form-value")
            page.locator('button[type="submit"]').click()
            page.locator('a[href="/settings/"]').click()
            expect(page.locator('h2:text-is("Teams")')).to_be_visible()
            expect(page.get_by_placeholder("my-team")).to_be_visible()
            assert not blocked, blocked
            assert not errors, errors
            print(f"Login run {iteration + 1}: PASS")
            context.close()
        browser.close()


if __name__ == "__main__":
    main()
