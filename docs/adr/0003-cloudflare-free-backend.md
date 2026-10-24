# 0003 — Add Cloudflare while retaining the Azure backend

The owner authorized a Cloudflare-only deployment using free services, while preserving the original .NET/Azure release path. Workers cannot host the existing ASP.NET Core/SQL Server application directly. The application therefore has a second backend in `src/cloudflare`; the React app, same-origin URLs and API contract remain shared.

Cloudflare uses a TypeScript Worker, D1 for transactional marketplace records, Workers KV for image bytes, and bundled frontend assets. Authentication uses opaque session cookies with D1-held token hashes and CSRF tokens. Passwords use ASP.NET Identity V3 PBKDF2-HMAC-SHA512 with 100,000 iterations; a golden vector is verified by both the Worker and the actual .NET Identity hasher. Sessions are specific to each deployment and must be invalidated during migration.

D1 stores UUIDs as text, UTC timestamps as ISO strings and EUR amounts as integer cents. Reservation and payment invariants use checked SQL transitions, version comparisons, D1 atomic batches and SQL triggers; they do not assume SQL Server row locks exist in SQLite. The original backend retains EF migrations, SQL Server reservation locking, rowversion concurrency and its real SQL Server integration suite. The Cloudflare suite independently exercises actual SQLite through workerd/D1, including suspension, ASAP, ownership, overlapping acceptance, idempotency and exactly one simulated payment.

The implementations are alternatives. They do not share a live database, credentials store, session cookie format or background synchronization. Production Cloudflare bindings remain guarded placeholders; the public deployment uses only a dedicated fictional staging database and KV namespace. No Azure resources or paid Cloudflare plan are created by this decision.

## Moving to the original Azure release path later

The original .NET projects, Azure infrastructure, CI, migration artifacts and deployment workflow remain available. Moving an established Cloudflare marketplace requires a reviewed data transfer; changing a URL alone does not migrate users or bookings:

1. Freeze writes and back up/export D1 plus the referenced KV image objects. Rehearse the transfer into a separate SQL Server database before cutover.
2. Apply the original reviewed EF migrations. Import identities/role membership and domain rows in foreign-key order, preserving UUIDs, verification/suspension states and audit/booking/payment history. Translate cents to decimal EUR, UTC text to the matching SQL types, and D1 modes/joins to the EF relationships. Let SQL Server generate rowversion values.
3. Preserve compatible password hashes and security stamps; expire sessions and password-reset tokens so everyone signs in again. Copy media to the configured Azure storage adapter and reconcile every metadata/object reference.
4. Reconcile row counts, monetary totals, exactly one payment per completed booking, review ownership and reservations. Run the real SQL tests, frontend browser journeys and isolated HTTPS staging smoke against the imported data before switching DNS.
5. Keep the original export and a code rollback plan. If writes have resumed, a rollback also needs an explicit reconciliation plan; switching between two divergent databases loses changes.

No bulk import tool or cross-provider migration rehearsal has been implemented. API parity and password compatibility reduce migration work; they do not establish lossless data transfer by themselves. Live email, genuine payments, legal approval and verified worker recruitment remain separate launch requirements.
