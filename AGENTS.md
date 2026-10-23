# Daqqa t’Id engineering

The owner has additionally authorized a Cloudflare-only backend in `src/cloudflare` using Workers, D1 and free-tier KV, while preserving the original .NET/Azure implementation and shared React API contract. Keep both paths usable. Cloudflare uses integer EUR cents, UTC ISO timestamps, D1 transaction/trigger-backed reservation constraints and explicit migrations. The SQL Server invariants below still apply to the Azure path; never substitute SQLite for its SQL-backed tests. No paid Cloudflare services or Azure resources may be enabled without authorization.

Build the fixed .NET 10 / EF Core SQL Server / React TypeScript modular monolith in the user brief. Domain owns entities and rules; Application owns booking and matching services; Infrastructure owns EF, Identity, storage, seed and migrations; Api owns HTTP, authorization, SEO and hosting; frontend owns responsive UI. See docs/API-CONTRACT.md for shared wire shapes.

Use nullable C#, asynchronous I/O, UTC persistence and Europe/Malta display, decimal EUR amounts and readable feature services. Never weaken verification or bypass failing tests. Never fabricate availability, ratings, payments or deployment.

Commands: `dotnet test DaqqaTid.slnx`; `npm ci --prefix src/frontend`; `npm run check --prefix src/frontend`; `npm run build --prefix src/frontend`; `npx playwright test` from tests/e2e. Integration checks require SQL Server and TEST_SQL_CONNECTION; CI must provide it. See README for exact startup.

Generate reviewed EF migrations; never EnsureDeleted or auto-migrate production. Keep customer addresses private except assigned workers. All cookie-authenticated writes require CSRF. All roles/ownership and booking transitions are validated by the server. SQL transactions must serialize overlapping reservations per worker; unique request and payment indexes enforce idempotency. Demo payments cannot charge money. Do not commit secrets or expose privileged demo access in production.

Work on a feature branch. Done means real builds, functional UI/API journeys, SQL concurrency checks, deployment instructions, and truthful docs/PROGRESS.md. PR descriptions state behavior, actual checks and unresolved limits. Never merge main automatically. Use existing checkout; cloud tasks are already isolated, so do not create worktrees unless explicitly requested.
