# Azure infrastructure

`main.bicep` provisions one Linux App Service for the same-origin API and Vite output, Azure SQL, private Blob container, and Application Insights/Log Analytics. Use the operator flow in [DEPLOY-AZURE.md](../docs/DEPLOY-AZURE.md). The SQL administrator password is a bootstrap secret only; never put it in source, workflow variables, or app settings. Assign the web app's system identity as a contained database user and grant only required application roles. Configure the SQL Entra administrator and restrict SQL networking before production use.

The database SKU is a low-cost starting point and App Service default is Basic B1; both are parameters. Resource cost depends on region, SKU, storage, log ingestion, backups, and usage. Bicep deployment creates chargeable resources. It is never invoked automatically by CI.
