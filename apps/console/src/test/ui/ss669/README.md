# Storage billing browser checks

This standalone Next app imports the production Settings and Plan & Usage pages,
billing hooks, query provider, API client, charts, and UI components. It follows
the existing `ss640` fixture pattern. Only user identity, team-directory server
actions, analytics, and local API responses are substituted. Production Console
authentication and configuration are unchanged.

The normal `bun run dev` command still requires Console's Supabase configuration
and a signed-in session. It cannot provide these billing scenarios by itself.
This fixture needs no credentials or external services and never changes a team
or sends a payment request. It verifies rendering over simulated service data,
not Supabase sign-in, the production proxy, or backend billing calculations.

## Open the pages

From the repository root:

```sh
bun --filter @superserve/console run dev:storage-ui
```

Open `http://127.0.0.1:4174/settings/?scenario=tracked`. Available scenarios:

| Scenario      | Storage state                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------- |
| `tracked`     | Nonzero advertised rate and usage; storage is not billable                                    |
| `zero`        | Billable storage with zero usage and zero storage charge                                      |
| `paid`        | Billable storage; tracked usage before activation costs zero, later usage costs $1.25         |
| `credited`    | Same positive storage charge; credits cover the full invoice                                  |
| `unavailable` | Missing legacy storage measurements; known compute charges and billing summary remain visible |

The production **Billing & Usage** link keeps the fixture selection. Direct entry
also works at `/plan-usage/?scenario=paid`. Each scenario URL should be opened
with a full navigation. Setup completes before billing hooks mount, avoiding a
race between the first API request and scenario selection. Unknown scenarios
and API calls without setup fail instead of silently choosing a default response.

## Run verification

Use a Python environment containing Playwright and its Chromium browser. If one
is not already available:

```sh
python3 -m venv .venv/storage-ui
.venv/storage-ui/bin/python -m pip install -r apps/console/src/test/ui/ss669/requirements.txt
.venv/storage-ui/bin/python -m playwright install chromium
```

Set `UI_TEST_PYTHON` to that environment's absolute Python path. Then run from the
repository root:

```sh
UI_TEST_PYTHON="$PWD/.venv/storage-ui/bin/python" bun --filter @superserve/console run test:storage-ui
```

The verifier starts and stops its own loopback fixture server, rejects an existing
fixture, and checks a per-run server identifier to avoid startup races. To use a fixture
server you already started, append `--base-url http://127.0.0.1:4174`. Append
`--output /tmp/ss669-browser` to choose a screenshot directory; otherwise a fresh
temporary directory is printed on completion.

Run the server-ownership regression checks separately with the same Python:

```sh
"$UI_TEST_PYTHON" -m unittest discover -s apps/console/src/test/ui/ss669 -p test_verify.py
```

Each scenario gets a fresh browser context. Checks cover eight page states,
Settings-to-usage navigation, matching summary responses, rates, storage badges
and charges, chart legends, pre/post-activation costs, and hover text. External
requests, browser errors, failed API responses, and framework error overlays fail
the run. The fixture API rejects payment writes. Screenshots include Settings,
the usage resource cards, and the chart for each scenario.
