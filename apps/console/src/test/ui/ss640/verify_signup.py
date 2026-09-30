"""Run against the isolated SS-640 Next fixture with Python Playwright installed.

Usage: python verify_signup.py
Uses only synthetic account values; captures no credentials or screenshots.
"""
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

BASE = 'http://127.0.0.1:4173'
VALUES = {
    'Full Name': 'Synthetic account',
    'Email': 'fixture@example.test',
    'Password': 'synthetic-form-value',
    'Confirm Password': 'synthetic-form-value',
}


def verify(browser, case, *, signup):
    context = browser.new_context(service_workers='block')
    violations = []
    runtime_errors = []

    def guard(route):
        url = urlsplit(route.request.url)
        if f'{url.scheme}://{url.netloc}' != BASE:
            violations.append(f'{url.scheme}://{url.netloc}')
            route.abort()
        else:
            route.continue_()

    context.route('**/*', guard)
    page = context.new_page()
    page.on('pageerror', lambda error: runtime_errors.append(str(error)))
    try:
        route = '/auth/signup/' if signup else '/auth/callback/'
        page.goto(f'{BASE}{route}?ui_case={case}', wait_until='networkidle')
        if signup:
            # Exercise the production inputs and handlers, including blank-form
            # validation, instead of seeding component state through test props.
            for placeholder in VALUES:
                expect(page.get_by_placeholder(placeholder, exact=True)).to_have_value('')
            page.get_by_role('button', name='Sign Up', exact=True).click()
            expect(page.get_by_text('Name is required.', exact=True)).to_be_visible()
            for placeholder, value in VALUES.items():
                page.get_by_placeholder(placeholder, exact=True).fill(value)
            page.get_by_role('button', name='Sign Up', exact=True).click()
            expect(page.locator('h1')).to_have_text('Check Your Email')
            expect(page.get_by_text(VALUES['Email'], exact=True)).to_be_visible()
            expect(page.locator('button[type="submit"]')).to_have_count(0)
            link = page.get_by_role('link', name='Sign in', exact=True)
        else:
            expect(page).to_have_url(f'{BASE}/auth/auth-code-error/')
            expect(page.locator('h1')).to_have_text('Authentication Error')
            link = page.get_by_role('link', name='Try Again', exact=True)
        expect(link).to_be_visible()
        expect(link).to_have_attribute('href', '/auth/signin/')
        assert not violations, f'External requests attempted: {violations}'
        assert not runtime_errors, f'Browser runtime errors: {runtime_errors}'
        print(f'PASS {case}', flush=True)
    finally:
        context.close()


if __name__ == '__main__':
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            for _ in range(3):
                verify(browser, 'ss640-email-confirmation', signup=True)
                verify(browser, 'ss640-google-auth-error', signup=False)
        finally:
            browser.close()
