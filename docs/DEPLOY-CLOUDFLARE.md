# Cloudflare deployment

This deploys the TypeScript Worker API with the existing Vite app in the same origin. The Worker serves API and SEO routes before falling back to Vite assets, so browser requests, cookies, and canonical URLs stay on one origin. The existing .NET/Azure deployment remains available separately.

The intended configuration uses Cloudflare Workers Free, D1, and Workers KV. It does not require R2, Containers, a paid Workers plan, or a card-backed storage service. The quota figures below come from Cloudflare's published plan documentation; they do not confirm the active account's plan or resource settings. Recheck the [Workers pricing and limits](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing and limits](https://developers.cloudflare.com/d1/platform/pricing/), and [KV pricing and limits](https://developers.cloudflare.com/kv/platform/pricing/) before onboarding real traffic.

| Service | Free allowance documented by Cloudflare | Operational consequence |
| --- | --- | --- |
| Workers | 100,000 requests per day and 10 ms CPU per invocation | Static assets are served through the Worker; keep API handlers bounded and monitor daily requests. |
| D1 | 5 million rows read and 100,000 rows written per day, with 5 GB total storage | Booking and catalog writes consume the write quota; design list endpoints with bounded pagination and indexes. |
| Workers KV | 100,000 reads, 1,000 writes, 1,000 deletes and 1,000 list operations per day, with 1 GB total storage | KV suits infrequently changed media, not high-frequency mutable records. Cloudflare allows up to 25 MiB per value; this API caps an uploaded image at 5 MiB. |

Cloudflare's free quotas reset daily on the provider's schedule and can stop or limit requests when exhausted. The limits are shared across resources on the account, not reserved for this application. Do not promise uptime or capacity from these quotas alone. Monitor usage in the dashboard and review current plan behavior before enabling broader traffic.

Cloudflare's published Free allowance lists 10 ms CPU per invocation. An explicit `limits.cpu_ms` setting was rejected with error 100328 on the Free plan, so the Worker uses Cloudflare's enforced plan default; no plan change was made. The staging D1 migration and Worker deployment succeeded. Public functional verification is recorded separately in [PROGRESS.md](PROGRESS.md).

## Local setup and actual SQLite-backed tests

Use Node.js 22 or newer. Cloudflare dependencies are isolated from the React package so the Workers test pool can use its compatible Vitest version.

```sh
npm ci --prefix src/cloudflare
npm run check --prefix src/cloudflare
npm test --prefix src/cloudflare
```

The Vitest Workers pool runs tests in `workerd` and binds D1 to the local SQLite implementation. D1 integration tests execute real SQL against that database; no remote Cloudflare account or mocked database is used. For the local app, the script builds the Vite assets, applies SQL migrations to local D1, and starts the Worker at `http://127.0.0.1:8787`:

```sh
scripts/dev-cloudflare.sh
```

Local D1 state is stored by Wrangler under `.wrangler/state`. It is disposable development data. Reset it only after confirming you do not need that local data.

## Staging resources and environment bindings

The staging D1 database and KV namespace have been provisioned, the initial migration applied remotely, and the Worker published at [`https://daqqa-t-id-staging.daqqatid-75d7e2e4.workers.dev`](https://daqqa-t-id-staging.daqqatid-75d7e2e4.workers.dev). See PROGRESS for public functional checks. Production resources still need separate provisioning and review. Keep environment databases and media namespaces separate; the app does not initialize remote databases automatically.

The staging binding IDs and origin are recorded in `src/cloudflare/wrangler.jsonc`. Local and production IDs and the production origin remain placeholders until those environments are provisioned. Check the selected Wrangler environment before running a remote command:

- `DB` must reference the D1 database for that Wrangler environment.
- `MEDIA` must reference the matching KV namespace.
- `PUBLIC_ORIGIN` must equal the final HTTPS origin served by that Worker.
- `STAGING_DEMO_DATABASE_NAME` must match the staging D1 database name exactly. It must end with `_staging_demo`, which the staging demo guard requires.

Do not commit API tokens or passwords. `ENVIRONMENT` is set per Wrangler environment. The staging configuration enables fixture creation only when the bound D1 database carries matching staging and database-name markers and has no real worker profiles; production is disabled and uses a separate database. No Worker secret is needed for fixture passwords: the endpoint generates a fresh password for each fictional account, stores only its password hash in D1, and returns the password once to an authenticated administrator. Do not log or share that response. There are no shared public administrator credentials; provision access to an administrator account privately before invoking the fixture endpoint.

The generated Worker type declarations are derived from `wrangler.jsonc`:

```sh
npm run types --prefix src/cloudflare
```

`npm run check` regenerates the ignored declarations before TypeScript checking, and Cloudflare CI runs that check. Do not place API tokens in generated files.

## Apply migrations

Review SQL changes in `src/cloudflare/migrations` before applying them. Back up any non-disposable database, then apply the migration set to the intended environment:

```sh
cd src/cloudflare
npx wrangler d1 migrations list DB --env staging --remote
npx wrangler d1 migrations apply DB --env staging --remote
```

These commands use the `DB` binding from the selected staging environment. Repeat against production only after its separate D1 binding exists, the change has been reviewed, and staging has been exercised. Check the database binding and environment before every `--remote` command. Never use destructive reset commands on remote databases.

The existing staging database already has its guard markers. For a newly provisioned isolated demo database only, verify the actual D1 binding/name first, then set `deployment_info` keys `database_name=daqqa-t-id_staging_demo` and `environment=staging`. They must match the selected staging variables exactly. Do not add these markers to a real marketplace database or a production binding. The migration deliberately leaves the marker table empty.

For owner administration, register through the app using a private password. An authorized account operator can then confirm the exact user ID/email in D1, promote that specific user to `Admin` and record the decision in `audit_entries`. The user should sign out and back in. Public registration accepts only Customer/Worker; the app never promotes the first registrant automatically. Do not add a shared administrator password to Wrangler variables, source or chat.

## Deploy

Authenticate Wrangler with an operator account or a narrowly scoped Cloudflare API token. Keep tokens in the local secret store or CI secret store; never paste them into command arguments, logs, source, or chat. For an operator-driven deployment, the script checks that the selected environment's placeholder IDs and origin have been replaced, runs type checks and the SQLite-backed tests, builds the frontend, and publishes the selected Worker:

```sh
scripts/deploy-cloudflare.sh staging
scripts/deploy-cloudflare.sh production
```

The script publishes code and assets only; it does not create or migrate remote resources. Run it from a reviewed commit after its matching GitHub checks pass. Cloudflare Worker code is not rolled back by reverting D1 data; use a reviewed forward migration for schema corrections and deploy a previously verified Worker version for code rollback.

The `Cloudflare Worker CI` workflow checks types, runs Worker tests in workerd with local SQLite D1, builds the frontend, validates the Worker bundle with Wrangler's dry run, and runs five Playwright browser journeys against a local Wrangler Worker and D1 database. It has no Cloudflare credentials and does not deploy or mutate account resources. The existing .NET/Azure CI and deployment workflows remain available.

After deployment, check the Worker health endpoint, API read path, SPA route fallback, canonical metadata, and private photo upload/read flow against the staging origin. Run `npm run smoke:staging --prefix tests/e2e` with protected `STAGING_SMOKE_URL`, `STAGING_ADMIN_EMAIL` and `STAGING_ADMIN_PASSWORD` environment variables. It exercises the isolated booking lifecycle, intended recipient inboxes, private image bytes/anonymous denial, review and one simulated payment. Real support checkout must stay disabled. For remote targets the script uses the inherited HTTPS proxy when present; local CI traffic stays direct. Confirm the requests use the intended D1 and KV bindings and review provider usage dashboards. No photo delete API is exposed. Record publication and actual functional checks separately.

## Account token scopes

For an account-level API token used for worker deploys, grant the minimum Cloudflare permissions Wrangler documents for the operations being performed. For this setup that generally means Workers Scripts:Edit, Workers KV Storage:Edit, D1:Edit, and Account Settings:Read on the single intended account; verify Wrangler's current requirements before issuing the token. The operator still needs the account ID for the selected account. Do not grant Zone-wide permissions unless attaching a custom domain requires them. Do not put token values in GitHub variables; if CI deployment is added later, use a protected environment secret and a scoped token.

## Free tier operational limits

KV is eventually consistent and has a daily write limit, so keep images immutable after upload and use generated keys. The Worker should reject oversized uploads before writing to KV, and media metadata should live in D1 only if the schema/API explicitly calls for it. Do not use KV for booking state, sessions, or other records that need transactional consistency. D1 provides SQLite semantics but has per-query and database-size limits; keep queries indexed and transactions short. Cloudflare documents the current service quotas and any overage behavior at the pricing links above; re-check before changing limits or traffic assumptions.


## Booking notification rollout

Apply additive reviewed migration `0002_booking_notifications.sql` before deploying this feature. It adds recipient inboxes, session-bound subscriptions, a leased delivery outbox and atomic booking/review notification triggers. Do not reset or backfill fictional events into real accounts. Configure the three VAPID secrets described in [NOTIFICATIONS.md](NOTIFICATIONS.md), preserving the key pair between releases. Staging has a one-minute retry cron plus immediate delivery scheduling. Production must explicitly configure its own retry cron before a real launch; secrets and environment triggers are not inherited automatically. No paid queue or notification subscription is required.

Run the HTTPS staging smoke after publishing. It now checks the intended recipients for each booking event and review, and verifies that real support checkout is disabled. Actual phone receipt still requires an opted-in device. Optional platform support is a separate Production-only Stripe Payment Link setting, documented in [MONETIZATION.md](MONETIZATION.md); never configure real charging in the fictional demo.
