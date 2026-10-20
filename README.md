# Daqqa t’Id

Daqqa t’Id connects people in Malta and Gozo with local service professionals. The MVP is a .NET 10 modular monolith with React/Vite served from the same ASP.NET Core origin, and SQL Server for persistence.

## Run locally

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

Set `TEST_SQL_CONNECTION` for integration tests to the local SQL connection; use a disposable database named `DaqqaTid_CI` for the suite. EF commands use `DAQQA_TID_SQL_CONNECTION`; the running API uses the .NET configuration key `ConnectionStrings__DefaultConnection`. When no connection is configured, the development API falls back to LocalDB; Compose sets this configuration key explicitly to use its SQL Server container. Apply migrations before browsing. Open http://localhost:8080; run `docker compose -f compose.yml logs -f app` to inspect startup. Compose builds the React assets into the API image and serves them with the API from one origin. Compose and Azure enable the idempotent reference-data seed for roles, service categories, localities, and settings. It does not create worker profiles, so no live provider coverage is implied. Apply the reviewed migration before startup; production contains no public bootstrap credentials. See [Azure deployment](docs/DEPLOY-AZURE.md) and [API contract](docs/API-CONTRACT.md).

SQL data is retained in the `daqqatid-sql` named volume. `docker compose down -v` deletes that local database. Demo payments are simulated; there is no live payment processing. Public demo availability and ratings must come from persisted records.

## Engineering decisions

Deployment uses Azure App Service, Azure SQL, managed identity, private blob storage, and optional GitHub OIDC. Provisioning is manual and creates chargeable resources. Read the migration, identity, and teardown steps in the deployment guide before using a real Azure subscription. MCP integration remains optional; see [MCP integration](docs/MCP-INTEGRATION.md).

For a one-command local fictional demo, run `node scripts/dev.mjs`. It creates an ignored local password only when none exists, starts SQL, applies migrations, builds the frontend, and starts the same-origin application. It requires the tools above and access to Microsoft's SQL container downloads. Set `DAQQA_DEV_PORT=5180` if the default port 5080 is already in use; the helper uses the selected port for the app and its public origin. The full startup was exercised in the cloud development environment, including migration application and a successful `/health/ready` response against SQL Server. Demo persona access is available only when both Development and `Demo__Enabled=true` are set; the helper binds to the local machine. Production never exposes demo personas.

Delivery status, actual test results and outstanding launch gates are in [docs/PROGRESS.md](docs/PROGRESS.md). A successful build does not establish that SQL concurrency or Azure deployment has been verified.
