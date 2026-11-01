---
name: testing-and-quality
description: Verify the product through meaningful unit, SQL integration, frontend, and browser tests.
---

- Prefer tests that exercise observable behavior and real SQL Server transactions for persistence invariants.
- Keep frontend checks, unit tests, integration tests, and Playwright outcomes distinct in reports.
- Use `TEST_SQL_CONNECTION` for integration tests; do not swap in EF InMemory for locking/concurrency.
- Never disable, skip, or weaken a failing assertion to get a green build.
- Run the narrow affected checks, then the repository's required suite when its dependencies are available.
