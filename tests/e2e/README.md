# Browser journey tests

Run `npm ci --prefix tests/e2e` followed by `npm test --prefix tests/e2e`. The app must be running at `E2E_BASE_URL` (defaults to `http://127.0.0.1:5080`) with its API and SQL database available. The real lifecycle test creates customer and worker accounts and needs seeded reference categories and localities. The fixture-backed ForMe plumber test is independent of the database and checks the discovery and request UI with controlled API responses.

In CI, install Playwright Chromium before running the suite. To use a system-installed browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (for example, `/usr/bin/chromium`). `npm run check --prefix tests/e2e` checks TypeScript and lists the browser tests without launching a browser.
