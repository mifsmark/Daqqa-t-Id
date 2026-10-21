# Delivery progress — 21 October 2026

## Status

Working, tested local marketplace MVP on `feat/marketplace-mvp`. SQL Server 2022 is running with persisted local development data. Migration `20261020213105_InitialMarketplace` was applied successfully. The same-origin React/API application is running and functional booking journeys pass. Azure resources have not been provisioned and no public staging URL has been verified. No production payments exist.

Lower-cost GPT-6 Luna agents implemented the backend, frontend, infrastructure and tests under the primary agent's architectural, security and integration review. Initial network blocks on SQL downloads and GitHub API access were resolved after the saved network configuration became effective; both operations now work.

## Engineering review follow-up — 21 October 2026

Read the latest owner engineering review on PR #1 (review ID 5592431343, originally reviewing `bbd8dc0`) and addressed all three findings on the existing feature branch:

1. **Worker suspension bypass:** verification resubmission returns 403 for Suspended profiles without modifying their material/status. Already Verified workers keep their approval when submitting replacement material; successful submissions are audited, and existing RowVersion concurrency prevents overwriting a simultaneous admin decision. Only an admin can reject or suspend approval. SQL-backed API tests cover unchanged suspension/material, public discovery, regulated eligibility after an approved worker resubmits, and denial of new non-regulated bookings after suspension.
2. **ASAP availability:** a request more than 15 minutes ahead cannot be labelled ASAP; accepted ASAP input is canonicalized to server UTC plus five minutes. AvailableNow is an extra opt-in at creation and never overrides weekly hours, explicit Malta-date time off or an overlapping reservation. Matching, acceptance and confirmation use the same schedule checks. The UI disables the scheduled date input for ASAP and sends near-now input. SQL-backed regressions cover future rejection, canonical time/idempotency, closed hours/time off, changed availability at acceptance/confirmation, concurrent accepts with exactly one winner, and busy-worker exclusion from matching/new requests.
3. **Controlled staging validation:** added an admin/CSRF-protected fictional fixture available only in explicitly enabled `Staging`, with an exactly matched dedicated `_staging_demo` SQL database. Production and Development cannot enable it. Each fixture uses unique random customer/worker credentials, an IsDemo worker, no privileged public persona, whole-site noindex/robots exclusion, a disabled sitemap and a visible staging banner. A real SQL test runs the lifecycle in the isolated migrated database. `tests/e2e/staging-smoke.mjs` runs the same authenticated create/accept/confirm/start/complete/review and single simulated payment check after deployment. CI also starts an actual HTTPS Staging host and runs this script with certificate validation enabled.

No schema changes were necessary; migration remains `20261020213105_InitialMarketplace`. No Azure deployment or merge was performed. Kingmakers work resources are explicitly excluded. See [STAGING-DEMO.md](STAGING-DEMO.md) for the personal-account, free-tier review and remaining deployment actions. The default infrastructure template remains billable and must not be run for a free-only request.

Local review checks passed: Release build (0 warnings/errors), 15 unit/model tests, 13 integration tests (including seven real SQL-backed scenarios and six hosting/configuration cases), all four frontend tests, type/lint/build, all three browser tests, backend format verification, Bicep compilation and the actual HTTPS staging smoke against SQL Server. The complete hosted CI rerun is pending; no hosted success is inferred from local checks.

Unfinished expansion work from the prior session (messaging, dynamic forms and privacy/media changes) was preserved in a local Git stash named `Preserve unfinished feature expansion before PR1 engineering review fixes`; it was not mixed into this security/staging review fix and remains incomplete.

## Plan and completed work

1. Foundation: .NET 10, React/TypeScript/Vite/Tailwind, Identity cookies, ASP.NET antiforgery, SQL Server EF migrations, role/ownership/suspension checks, throttling, structured problems, health checks, and documented architecture.
2. Marketplace: requested ten launch categories, database-driven modes, locality/radius matching, worker profiles and verification, weekly hours and date exceptions, availability toggle, saved addresses, direct requests, quotes, confirmed bookings, validated transitions, cancellations, simulated payments/commission ledger and reviews.
3. Usability and growth: mobile layout checked at 375px, three-step worker setup, clear booking status/price breakdowns, profile sharing and WhatsApp links, PWA/offline fallback, server-rendered SEO metadata/content, canonical URLs, JSON-LD, robots and sitemap. Empty-inventory categories use noindex until eligible real providers exist; fictional providers do not enter the sitemap. See LAUNCH-AND-GROWTH.md.
4. Media and account support: public worker photos, private confirmed-booking photos, size/type checks, local storage and optional private Azure Blob storage with managed identity; SMTP password recovery with honest unconfigured responses; privacy-request queue.
5. Administration: verification decisions, suspend/restore accounts, category/mode updates, commission configuration, booking oversight, simulated financial records, privacy requests and audit trail.
6. Delivery: same-origin publish output, Docker Compose, Azure Bicep, guarded GitHub CI/OIDC deployment, reviewed migration artifacts, operator guide, AGENTS.md and six focused skills.

## Verification evidence

| Check | Actual result |
| --- | --- |
| .NET Release solution build | Passed; zero warnings/errors |
| .NET unit/model tests | 15 passed, zero skipped |
| Integration tests | 13 passed, zero skipped: seven real SQL-backed scenarios and six hosting/configuration cases; review coverage described above. |
| SQL lifecycle coverage | ForMe plumber accept/confirm/start/complete/payment; WithMe quote/confirm; TeachMe quote/complete/review; admin verification; ownership/address/media restrictions; idempotency; concurrent overlapping accepts with one winner; cancellation releases reservation; repeated category updates |
| Browser tests | 3 passed: real registration/search, fixture-backed plumber screen regression, and a real API/SQL customer/worker lifecycle including confirmed-booking photo upload and review |
| Frontend | Type check, ESLint, four tests and production build passed; dependency audit reported zero vulnerabilities |
| Mobile/PWA | 375px landing/register have no horizontal overflow; offline fallback works; API/private responses are not service-worker cached |
| Database | Initial migration generated/applied; model has no pending changes; SQL singleton keys and declared FKs covered by model tests |
| Infrastructure | Bicep compilation and Compose/YAML configuration checks passed |
| Setup/start | cloud-install.sh executed; dev helper applied migrations, seeded development data and reached SQL readiness/functional API checks; repeat startup preserves existing profiles |

SQL-backed testing found and fixed new-entity tracking errors in worker offerings and booking history, plus replacement ordering for unique/composite keys. Tests retained their original ownership/concurrency assertions.

## Start and test

From the repository root, with .NET 10, Node 22+ and Docker available:

```sh
node scripts/dev.mjs
```

The helper creates an ignored local SQL password only when absent. If port 5080 is busy, set `DAQQA_DEV_PORT=5180`. It starts SQL, applies migrations, builds static assets and starts the local fictional demo. Processes must be restarted in a new task; dependency files and SQL volumes can be retained. The development-only persona selector is on the login page. Production never enables that selector.

```sh
node scripts/test-sql.mjs
npm run check --prefix src/frontend
npm run lint --prefix src/frontend
npm test --prefix src/frontend
npm run build --prefix src/frontend
```

Run browser checks from `tests/e2e` with `E2E_BASE_URL` pointing to the running app. In this cloud machine set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`; other machines can install Playwright Chromium normally. Do not point integration tests at a production database.

## Remaining launch actions and limits

- Azure deployment needs the owner's subscription/resource authorization, OIDC variables, SQL identities/firewall permissions and deployment review. Exact commands and cost categories are in DEPLOY-AZURE.md. No paid resources were created.
- Payments are simulated and no card details are collected. Legal/privacy text is a review placeholder. This is a controlled demo/pilot foundation, not a claim of live payment or legal readiness.
- SMTP and the Azure Blob adapter compile, but live SMTP delivery and Azure managed-identity Blob access have not been exercised against configured cloud accounts. Local media upload/privacy behavior is verified.
- Booking photos are currently accepted after confirmation; request-stage photos are not implemented. Category-specific dynamic attribute forms, automated matching notifications/SMS, in-app chat, dispute case management and automatic privacy export/erasure are not implemented. Privacy requests are actionable admin tasks; see OPERATIONS.md.
- Geography uses known locality centroids, SQL geography persistence and Haversine distance. It does not represent live GPS or precise road travel time.
- A complete Docker image build was attempted in the earlier hosting investigation and failed during frontend npm installation (`Exit handler never called`). It is not a verified deployment path. The same-origin publish/ZIP path and actual SQL container are validated independently; Azure publication remains unperformed.
- Fictional demo workers have no invented reviews or completed-job counts. Recruit and verify actual workers before promoting real service coverage.

## Next three priorities

1. Finish hosted CI review and prepare an isolated fictional staging environment in a personal Azure subscription, using STAGING-DEMO.md; no Kingmakers or unapproved billable resources.
2. Complete legal/operational review, configure support/mail, and recruit a small verified worker cohort with assisted onboarding.
3. Run a locality-focused pilot; measure request-to-confirmation conversion and worker response, then prioritize notifications and the largest observed usability issue.
