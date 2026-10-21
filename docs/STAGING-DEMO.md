# Isolated fictional staging demo

Use a **personal Azure account/subscription** dedicated to Daqqa t’Id. Do not use the owner's Kingmakers work tenant, subscriptions, identities or resources. A new personal Azure account can be created at https://azure.microsoft.com/free/; Azure may require identity/payment verification. This repository does not create accounts or resources automatically.

No public Azure deployment has been performed. The default `infra/main.bicep` creates billable resources, including B1, Basic SQL, Blob and monitoring. **Do not run that template for a free-only request.** Azure's [F1 shared App Service plan](https://learn.microsoft.com/azure/app-service/overview-hosting-plans) and [SQL free offer](https://learn.microsoft.com/azure/azure-sql/database/free-offer) are an option to evaluate in the personal subscription: SQL includes 100,000 vCore seconds and 32 GB data/backup per database per month, with `AutoPause` on free-limit exhaustion. Choose pause rather than paid continuation; verify offer eligibility and the complete resource cost summary before any deployment. F1 has CPU/storage quotas, sleeps and no production availability guarantee. Blob/monitoring in the default template are separate cost categories. No free-only infrastructure provisioning has been verified here.

## Explicit isolation and access

The fixture is disabled by default. To enable it, the application must have **all** of:

- `ASPNETCORE_ENVIRONMENT=Staging` (never Development or Production).
- `StagingDemo__Enabled=true`.
- `StagingDemo__DatabaseName=daqqatid_staging_demo` (or another dedicated name ending in `_staging_demo`).
- `ConnectionStrings__DefaultConnection` pointing at exactly that database, using the App Service managed identity.
- `PublicOrigin=https://<DEMO_APP>.azurewebsites.net`, HTTPS, `Demo__Enabled=false` and reference-data seeding enabled after reviewed schema migration.

Use a separate App Service/database with no real customer or worker records. The environment/database-name guard prevents accidental activation in a normal production configuration; it is not a substitute for separating Azure resources and keeping real data out. The fixture refuses creation if a real worker profile already exists. No database deletion/reset is performed. Every fixture adds uniquely named fictional customer/worker accounts and a worker marked `IsDemo`; no administrator is created by this endpoint. Only non-regulated cleaning is offered. Each generated account has a fresh random password returned once to the authorized caller, never a shared public password. Treat that response as private and do not log it.

`POST /api/admin/staging-demo/fixture` requires an existing administrator session, CSRF and rate limiting. Provision the private administrator using the bootstrap procedure in [DEPLOY-AZURE.md](DEPLOY-AZURE.md), then remove bootstrap settings. The development persona endpoint remains unavailable. All demo responses carry `X-Robots-Tag: noindex, nofollow`, robots disallows the entire site, the sitemap is disabled, and the UI shows a fictional staging banner. Fictional worker profiles are individually noindex even outside this demo mode. These are crawler controls, not access protection; use App Service access restrictions for a private pilot if needed.

The paid infrastructure template supports `isolatedStagingDemo=true sqlDatabaseName=daqqatid_staging_demo` for an independently approved paid deployment. It is intentionally **not executed** by CI and is not a free-tier provisioning script. A free-only deployment must be separately reviewed and use no paid add-ons. If using F1 persistent filesystem media, set `Media__StoragePath=/home/daqqatid/uploads` outside `wwwroot`, monitor its shared storage quota and back it up; do not put real pilot uploads on an ephemeral container directory.

## Verify after deployment

Configure the `staging` GitHub environment with the OIDC variables/migration connection in [DEPLOY-AZURE.md](DEPLOY-AZURE.md) plus protected secrets `STAGING_ADMIN_EMAIL` and `STAGING_ADMIN_PASSWORD` for the isolated demo administrator. Dispatch **Deploy staging** on the same feature-branch commit as a successful manual/push CI run, with the reviewed artifact's migration ID/digest and `isolated_demo_smoke=true` (the default). PR-event CI artifacts are deliberately ineligible for deployment; dispatch CI manually on the feature branch to get an eligible artifact. The environment review gate still applies. This does not merge the branch.

After migration, deployment and health checks, the workflow runs:

```sh
npm ci --prefix tests/e2e
npm run smoke:staging --prefix tests/e2e
```

For a manual run, set `STAGING_SMOKE_URL` and the two credentials through protected environment variables, never command-line arguments, repository files or PR comments. The smoke script requires HTTPS and refuses to mutate a target unless `/api/session` reports explicitly enabled staging demo mode and development personas are disabled. It signs in as the administrator, creates the fixture, logs in as its customer and worker, creates/accepts/confirms/starts/completes a booking, submits a fictional review and checks that the administrator sees exactly one simulated payment. Azure's `/health/ready` and actual API writes/reads exercise Azure SQL; no mocked API or in-memory database is used. Credentials are never printed.

The local SQL Server integration suite exercises the same controlled fixture and lifecycle against a separately migrated `_staging_demo` database, plus production/Development refusal, authorization, CSRF, fictional labels and indexing controls. This is local evidence, **not evidence of an Azure deployment**. Repeated smoke runs retain fictional audit/booking history; periodically recreate only the disposable demo resources with owner authorization. Never connect this fixture or cleanup process to a real marketplace database.

## Remaining owner steps

1. Create/connect a separate personal Azure subscription and confirm free-tier eligibility/limits without using Kingmakers. Review a free-only resource configuration; do not provision the default paid template.
2. Prepare the isolated demo app/database, SQL identities/firewall rules and HTTPS/media settings. Configure GitHub OIDC and the protected `staging` environment.
3. Bootstrap the private admin, review migration artifacts, dispatch deployment and run the full smoke above. Only then report its public URL as verified. Configure SMTP separately if testing password recovery; payments remain simulated.
