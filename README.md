# Daqqa t’Id

Daqqa t’Id connects people in Malta and Gozo with local service professionals. The shared React/Vite app supports two same-origin backends: Cloudflare Workers with D1/KV for free-tier hosting, and the original .NET 10/SQL Server implementation for Azure.

## Cloudflare staging and local development

Staging has been published at [daqqa-t-id-staging.daqqatid-75d7e2e4.workers.dev](https://daqqa-t-id-staging.daqqatid-75d7e2e4.workers.dev). It is a fictional, non-indexed demo with simulated payments. Deployment is recorded separately from public functional verification in [PROGRESS.md](docs/PROGRESS.md).

Use the [manual testing guide](docs/REAL-TESTING.md) for helper/customer test accounts and a complete booking. The [launch kit](docs/LAUNCH-KIT.md) provides recruitment messages and a proposed first-locality pilot; real-service promotion begins after its launch checks.

With Node 22 or newer:

```sh
npm ci --prefix src/frontend
npm ci --prefix src/cloudflare
scripts/dev-cloudflare.sh
```

See [Cloudflare deployment](docs/DEPLOY-CLOUDFLARE.md) for bindings, reviewed D1 migrations, tests and free quotas. The [backend decision](docs/adr/0003-cloudflare-free-backend.md) explains how the Azure path is retained and what a later data migration needs. The two backends do not synchronize databases automatically.

## Run the original .NET/SQL Server version locally

Requirements: .NET 10 SDK, Node 22, Docker Compose. Copy `.env.example` to `.env` and set a unique local SQL password (12+ characters with upper/lowercase, number, and symbol). Then:

```sh
docker compose -f compose.yml up -d sql
dotnet restore DaqqaTid.slnx
dotnet tool install --global dotnet-ef --version 10.0.13
DAQQA_TID_SQL_CONNECTION="Server=localhost,1433;Database=DaqqaTid;User Id=sa;Password=<your-local-password>;Encrypt=False;TrustServerCertificate=True" dotnet ef database update --project src/backend/DaqqaTid.Infrastructure --startup-project src/backend/DaqqaTid.Api
docker compose -f compose.yml up --build -d app
TEST_SQL_CONNECTION="Server=localhost,1433;Database=DaqqaTid_CI;User Id=sa;Password=<your-local-password>;Encrypt=False;TrustServerCertificate=True" dotnet test DaqqaTid.slnx
npm ci --prefix src/frontend
npm run check --prefix src/frontend
npm run build --prefix src/frontend
npm ci --prefix tests/e2e
(cd tests/e2e && npx playwright install chromium && E2E_BASE_URL=http://localhost:8080 npx playwright test)
```

Set `TEST_SQL_CONNECTION` for integration tests to the local SQL connection; use a disposable database named `DaqqaTid_CI` for the suite. EF commands use `DAQQA_TID_SQL_CONNECTION`; the running API uses the .NET configuration key `ConnectionStrings__DefaultConnection`. When no connection is configured, the development API falls back to LocalDB; Compose sets this configuration key explicitly to use its SQL Server container. Apply migrations before browsing. Open http://localhost:8080; run `docker compose -f compose.yml logs -f app` to inspect startup. Compose builds the React assets into the API image and serves them with the API from one origin. Compose and Azure enable the idempotent reference-data seed for roles, service categories, localities, and settings. It does not create worker profiles, so no live provider coverage is implied. Apply the reviewed migration before startup; production contains no public bootstrap credentials. See [Azure deployment](docs/DEPLOY-AZURE.md), [isolated staging demo](docs/STAGING-DEMO.md) and [API contract](docs/API-CONTRACT.md).

SQL data is retained in the `daqqatid-sql` named volume. `docker compose down -v` deletes that local database. Demo payments are simulated; there is no live payment processing. Public demo availability and ratings must come from persisted records.

## Engineering decisions

Cloudflare staging uses Workers Free, D1 and KV. It does not enable paid services. The original Azure option uses App Service, Azure SQL, managed identity, private blob storage, and optional GitHub OIDC. The default Azure template creates chargeable resources and must not be run for a free-only request. Read the migration, identity, and teardown steps in its deployment guide before using a personal Azure subscription. MCP integration remains optional; see [MCP integration](docs/MCP-INTEGRATION.md).

For a one-command local fictional demo, run `node scripts/dev.mjs`. It creates an ignored local password only when none exists, starts SQL, applies migrations, builds the frontend, and starts the same-origin application. It requires the tools above and access to Microsoft's SQL container downloads. Set `DAQQA_DEV_PORT=5180` if the default port 5080 is already in use; the helper uses the selected port for the app and its public origin. The full startup was exercised in the cloud development environment, including migration application and a successful `/health/ready` response against SQL Server. Demo persona access is available only when both Development and `Demo__Enabled=true` are set; the helper binds to the local machine. Production never exposes demo personas.

Delivery status, actual test results and outstanding launch gates are in [docs/PROGRESS.md](docs/PROGRESS.md). A successful build does not establish that SQL concurrency or Azure deployment has been verified.
