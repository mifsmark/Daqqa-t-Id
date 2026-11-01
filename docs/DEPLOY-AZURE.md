# Deploy staging to Azure

This repository is prepared for a single App Service serving the React build and ASP.NET Core API from one origin. Azure provisioning and deployment are manual and require an owner with access to the Azure subscription and GitHub repository. No Azure resources are created by CI. Do not add secrets to source files, PRs, issues, or logs.

For a working fictional staging journey, follow [STAGING-DEMO.md](STAGING-DEMO.md), including the explicit environment/database isolation and authenticated post-deployment booking smoke. Use a separate personal subscription; never use Kingmakers work resources. The default template below is billable and is not authorized by a free-only hosting request.

## Prerequisites and permissions

Use Azure CLI with Bicep support, .NET 10 SDK, GitHub Actions enabled, and a repository environment named `staging`. The operator needs permission to create resource groups/resources and role assignments in the subscription (typically Contributor plus User Access Administrator or Owner); the deployment service principal needs App Service deployment rights, access to the target subscription, and OIDC federation. A GitHub environment reviewer should approve deployments. Configure a Microsoft Entra administrator for SQL.

## Cost and sizing

Resources include an App Service plan, Azure SQL database and backups, Storage, Application Insights, and Log Analytics ingestion/retention. The default plan is Basic B1 and database Basic; choose the smallest suitable SKUs for a test workload, verify current regional pricing in Azure's calculator, and monitor logs/storage. Resource usage and SKU availability affect costs. Bicep creates billable resources and must be run only in an intended subscription.

## Provision

Choose globally unique lowercase names for the web app, SQL server, and storage (derived from the web app name). Supply the SQL bootstrap password through the CLI's secure prompt; it is not used by the running application. Keep the terminal/session private.

```sh
az login
az account set --subscription <SUBSCRIPTION_ID>
az group create --name rg-daqqatid-staging --location westeurope
read -rsp 'Temporary SQL bootstrap password: ' SQL_BOOTSTRAP_PASSWORD; echo
az deployment group create \
  --resource-group rg-daqqatid-staging \
  --template-file infra/main.bicep \
  --parameters environmentName=staging location=westeurope \
    webAppName=<UNIQUE_WEBAPP> sqlServerName=<UNIQUE_SQL_SERVER> \
    sqlAdminPassword="$SQL_BOOTSTRAP_PASSWORD" \
    sqlEntraAdminObjectId=<YOUR_ENTRA_OBJECT_ID> sqlEntraAdminName='<YOUR_ENTRA_DISPLAY_NAME>'
unset SQL_BOOTSTRAP_PASSWORD
```

Save the deployment outputs (web URL, App Service principal ID, SQL FQDN, storage account name) in a secure operator record. Do not paste credentials into the repo. The template creates an App Service managed identity, a SQL server/database, a private blob container, and monitoring resources. It enables `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` so Linux App Service processes the platform's forwarded scheme and client-IP headers before HTTPS redirection and secure-cookie handling. This trusts App Service's front end; keep Kestrel private behind that platform edge and do not expose the app process directly to untrusted clients. For a self-managed proxy, configure only its known proxy addresses instead of broadly trusting forwarded headers. See [Microsoft's Linux App Service guidance](https://learn.microsoft.com/aspnet/core/host-and-deploy/linux-nginx?view=aspnetcore-10.0#forward-the-scheme-for-linux-and-non-iis-reverse-proxies). SQL network access currently allows Azure services so the App Service can reach the database; that broad staging rule should be replaced with private endpoint/VNet integration or explicit App Service outbound IP rules before real data is used. Review storage network rules as well.

## Configure SQL identity and storage

Connect to the database as the configured Entra administrator. Create a contained user for the App Service identity and grant only the runtime permissions needed. For schema initialization/migrations, use a separate migration principal, not the application identity:

```sql
CREATE USER [<WEB_APP_NAME>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [<WEB_APP_NAME>];
ALTER ROLE db_datawriter ADD MEMBER [<WEB_APP_NAME>];
```

The GitHub runner temporarily adds its current outbound IPv4 address to the SQL firewall for the migration step and removes that rule immediately afterward. The OIDC deployment service principal must have Azure SQL server firewall-rule write permission and a contained Entra database user with narrowly scoped migration rights; the connection string uses `Authentication=Active Directory Default` to use the Azure CLI OIDC login. The runner requires outbound access to Azure SQL on TCP 1433. The App Service settings include `ConnectionStrings__DefaultConnection` with managed-identity SQL authentication and enable only the idempotent reference seed for roles, categories, localities, and commission defaults. It does not create demo worker profiles. Apply the reviewed migration before the app first starts. For the GitHub OIDC service principal, create a separate contained user in this database and grant schema migration permissions only on this application database:

```sql
CREATE USER [<DEPLOYMENT_SERVICE_PRINCIPAL_NAME>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [<DEPLOYMENT_SERVICE_PRINCIPAL_NAME>];
ALTER ROLE db_datawriter ADD MEMBER [<DEPLOYMENT_SERVICE_PRINCIPAL_NAME>];
ALTER ROLE db_ddladmin ADD MEMBER [<DEPLOYMENT_SERVICE_PRINCIPAL_NAME>];
```

Keep the deployment service principal dedicated to this repository/environment. `db_ddladmin` is database scoped but can change any schema object in this database; revoke that membership after migration if operationally practical. The private Blob container is provisioned as `media`; the template grants `Storage Blob Data Contributor` to the app identity. The adapter uses `Media__BlobServiceUri` and `Media__ContainerName` settings and managed identity; local filesystem storage remains the development fallback. Use managed identity credentials in the application, never account keys. Set required App Service settings in Configuration and restart the app after changing settings. Store secrets in Key Vault references where a feature requires them. To provision the first administrator, after migrations have been applied use the Azure Portal App Service Configuration page to set `BootstrapAdmin__Email` and a strong `BootstrapAdmin__Password` as protected settings. Restart the app once to create the account, then remove both `BootstrapAdmin__Email` and `BootstrapAdmin__Password` and restart; the account remains and its password can be changed through the normal account flow. Do not pass the password on a command line or store it in source. Password reset stays unavailable until a mail provider is configured.

## GitHub OIDC

Create an Entra application/service principal dedicated to this repository/environment. Add a federated credential whose issuer is `https://token.actions.githubusercontent.com`, subject is `repo:<ORG>/<REPO>:environment:staging`, and audience is `api://AzureADTokenExchange`. Grant it only the deployment permissions needed for the App Service and migration database. Configure GitHub repository variables:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_WEBAPP_NAME`
- `AZURE_RESOURCE_GROUP`
- `AZURE_SQL_SERVER_NAME`

Configure this GitHub environment secret:

- `AZURE_SQL_MIGRATION_CONNECTION` (connection string using `Authentication=Active Directory Default`; do not include a SQL password or use the bootstrap admin)

Set environment required reviewers and prevent untrusted branches from deploying. GitHub Actions use OIDC and need no client secret. The workflow fails when required configuration is absent. `CI_SQL_PASSWORD` is deliberately unnecessary: CI uses an isolated, ephemeral password for its SQL service.

## Build and apply database migrations

The deployment workflow takes the run ID of a completed successful CI run for the exact commit being deployed. CI publishes the app package and a `ci-release` artifact containing the compiled migration bundle, a normalized migration ID list, its SHA-256 manifest, and an idempotent SQL script for human review. Inspect `migrations.sql` in the CI artifact and copy its latest migration ID and bundle SHA-256 from the CI run summary. Then dispatch staging with that CI run ID, migration ID, digest, and `reviewed_migrations=true`. The workflow verifies the successful CI run, exact commit, artifact migration ID, and digest, then applies that exact downloaded bundle. It never recompiles the bundle during deployment.

For local inspection, install EF tools matching the solution's EF Core packages and generate SQL/bundle from the selected source commit:

```sh
dotnet tool install --global dotnet-ef --version 10.0.13
DAQQA_TID_SQL_CONNECTION='<connection to a disposable SQL Server database>' dotnet ef migrations script --idempotent --project src/backend/DaqqaTid.Infrastructure --startup-project src/backend/DaqqaTid.Api --output migrations.sql
DAQQA_TID_SQL_CONNECTION='<connection to a disposable SQL Server database>' dotnet ef migrations bundle --project src/backend/DaqqaTid.Infrastructure --startup-project src/backend/DaqqaTid.Api --configuration Release --output ./efbundle
sha256sum ./efbundle
```

The deployment workflow explicitly opens the runner's current IP to Azure SQL for the migration step and removes that firewall rule immediately afterward. Before this step, connect the deployed service principal to the database as a contained Entra user and grant only the reviewed migration permissions. Use a connection string with `Authentication=Active Directory Default`; after `azure/login` via OIDC, the EF bundle uses the authenticated Azure CLI identity. Never use the bootstrap SQL administrator in the workflow. The deployment identity needs a narrowly scoped Azure SQL firewall-rule write permission, a database migration principal, App Service deployment rights, and access to the GitHub OIDC federated credential. The runner needs outbound TCP 1433 to Azure SQL.

Never use `EnsureDeleted`, automatic startup migration, or destructive migration commands on staging. Take/confirm a backup before application, and use forward corrective migrations for schema rollback. GitHub environment reviewers should inspect the CI artifact's SQL script and confirm the run ID, commit, migration ID, and digest before approval.

## Deploy and verify

After a successful CI run, open Actions → Deploy staging → Run workflow. Enter the CI run ID, the migration ID and bundle SHA-256 from the CI summary, and set `reviewed_migrations` to true after inspecting the artifact SQL script. The `staging` environment approval gate must pass. The workflow validates the successful CI run and exact commit, downloads and verifies the same reviewed bundle, applies it, deploys the matching CI app artifact, and requests `/health/live`, `/health/ready`, and `/`. With the default `isolated_demo_smoke=true`, it also requires protected staging admin credentials and runs the real API booking lifecycle in STAGING-DEMO.md; a normal Production configuration cannot pass that demo smoke.

Open the URL printed by the workflow (or `https://<WEBAPP>.azurewebsites.net`). Confirm the landing page, same-origin API, and a real read path backed by Azure SQL. Do not claim a live deployment until the health and smoke checks pass. The App Service is configured to store uploads in its private Blob container through managed identity; password reset remains unavailable until a mail provider is configured.

## Logs and rollback

Use `az webapp log tail --resource-group rg-daqqatid-staging --name <WEBAPP>` for live application logs. For structured traces and failures, use the App Insights resource and associated Log Analytics workspace. Avoid logging addresses, credentials, or other personal data.

For an application rollback, redeploy a previously verified App Service package from its CI artifact or use App Service deployment history/slots if slots are configured. Keep the database compatible with both app versions; schema rollback requires a reviewed forward migration or tested backup restore, never a blind destructive downgrade.

## Stop or delete resources

To stop ongoing compute charges while retaining resources, stop the web app and scale down only after checking service implications. SQL and storage may continue to incur charges. To remove all staging resources after confirming nothing valuable remains:

```sh
az group delete --name rg-daqqatid-staging --yes --no-wait
```

Resource deletion is irreversible. Verify the resource group contains only this disposable staging deployment first.
