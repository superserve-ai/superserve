"""Verify West UI against the isolated fixture: python verify_west.py.

These checks cover real UI transitions over simulated service responses, not
backend ownership, durable retries, or credit issuance.
"""
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

BASE = 'http://127.0.0.1:4173'
CASES = ['loading', 'eligible', 'duplicate', 'missing-evidence',
         'registration-unavailable', 'uncertain', 'uncertain-retry']


def verify(browser, scenario):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000},
                                  service_workers='block')
    errors = []

    def guard(route):
        url = urlsplit(route.request.url)
        if f'{url.scheme}://{url.netloc}' != BASE:
            errors.append('External request attempted')
            route.abort()
        else:
            route.continue_()

    context.route('**/*', guard)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(f'{BASE}/settings/?ui_case=ss640-west-{scenario}', wait_until='networkidle')
        name = page.get_by_placeholder('my-team', exact=True)
        expect(name).to_have_value('')
        expect(page.get_by_text('East fixture team', exact=True)).to_be_visible()
        expect(page.get_by_text('West fixture team', exact=True)).to_have_count(0)
        name.fill('West fixture team')
        page.locator('[aria-label="Team region"]').click()
        page.get_by_role('option', name='US West', exact=True).click()
        page.get_by_role('button', name='Create Team', exact=True).click()
        if scenario == 'loading':
            expect(page.get_by_role('button', name='Creating...', exact=True)).to_be_disabled()
            expect(name).to_have_value('West fixture team')
            expect(page.locator('[aria-label="Active team"]')).to_have_count(0)
        else:
            if scenario.startswith('uncertain'):
                expect(page.get_by_text('Something went wrong. Please try again.', exact=True)).to_be_visible()
                expect(name).to_have_value('West fixture team')
                expect(page.get_by_role('button', name='Create Team', exact=True)).to_be_enabled()
                expect(page.get_by_text('Team West fixture team created in US West', exact=True)).to_have_count(0)
                if scenario.endswith('retry'):
                    page.get_by_role('button', name='Create Team', exact=True).click()
            if scenario != 'uncertain':
                expect(page.get_by_text('Team West fixture team created in US West', exact=True)).to_be_visible()
                expect(page.locator('div.border-dashed > div > span.text-sm:text-is("West fixture team")')).to_have_count(1)
                expect(page.locator('[aria-label="Active team"]')).to_have_text('West fixture team · US West')
                expect(name).to_have_value('')
        expect(page.locator('[aria-label="Team region"]')).to_have_text('US West')
        assert not errors, errors
        print(f'PASS ss640-west-{scenario}', flush=True)
    finally:
        context.close()


if __name__ == '__main__':
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            for scenario in CASES:
                verify(browser, scenario)
        finally:
            browser.close()
