# Browser journey tests

Run `npm ci --prefix tests/e2e` followed by `npm test --prefix tests/e2e`. The app must be running at `E2E_BASE_URL` (defaults to `http://127.0.0.1:5080`) with its API and database available. The same five journeys run against .NET/SQL Server and Cloudflare/Wrangler/D1. Use a disposable local or CI database; these tests create accounts and must not target a real marketplace database.

The real lifecycle creates customer/worker accounts and requires seeded reference categories/localities. Additional real UI journeys cover mobile three-step worker setup, retained services/hours, validation before saving, native-share cancellation/failure, login/signup return to an actual selected helper and external redirect rejection. The fixture-backed ForMe plumber test checks the authenticated discovery/request UI with controlled API responses. Only that explicitly named fixture screen regression mocks the API.

In CI, install Playwright Chromium before running the suite. To use a system-installed browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (for example, `/usr/bin/chromium`). `npm run check --prefix tests/e2e` checks TypeScript and lists the browser tests without launching a browser.

For human testing of the public fictional demo, use [REAL-TESTING.md](../../docs/REAL-TESTING.md). The separate `smoke:staging` script uses a private admin-protected fixture in an explicitly isolated staging database; it never exposes shared administrator credentials.
