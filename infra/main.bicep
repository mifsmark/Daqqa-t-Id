targetScope = 'resourceGroup'

@description('Short environment name such as staging.')
@minLength(2)
@maxLength(12)
param environmentName string = 'staging'
param location string = resourceGroup().location
@description('Globally unique App Service name.')
@minLength(3)
@maxLength(50)
param webAppName string
@description('Globally unique SQL logical server name; lowercase letters and digits only.')
param sqlServerName string
param sqlDatabaseName string = 'daqqatid'
@description('App Service plan SKU. Free/shared plans are not suitable for production.')
param appServiceSkuName string = 'B1'
param appServiceSkuTier string = 'Basic'
@secure()
@description('SQL administrator password for bootstrap only. Configure Microsoft Entra admin and managed identity for normal access.')
param sqlAdminPassword string
@description('Optional existing Microsoft Entra administrator object ID; set during deployment.')
param sqlEntraAdminObjectId string = ''
@description('Optional Entra administrator display name. Required when object ID is supplied.')
param sqlEntraAdminName string = ''

var storageName = toLower('dq${uniqueString(resourceGroup().id, webAppName)}')

resource appPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  tags: { environment: environmentName, application: 'DaqqaTid' }
  name: '${webAppName}-plan'
  location: location
  sku: {
    name: appServiceSkuName
    tier: appServiceSkuTier
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  tags: { environment: environmentName, application: 'DaqqaTid' }
  name: webAppName
  location: location
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: appPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      alwaysOn: appServiceSkuName != 'F1' && appServiceSkuName != 'D1'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/health/ready'
      appSettings: [
        { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' }
        { name: 'ASPNETCORE_FORWARDEDHEADERS_ENABLED', value: 'true' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'PublicOrigin', value: 'https://${webAppName}.azurewebsites.net' }
        { name: 'Database__SeedReferenceDataOnStartup', value: 'true' }
        { name: 'ConnectionStrings__DefaultConnection', value: 'Server=tcp:${sqlServerName}.${environment().suffixes.sqlServerHostname},1433;Initial Catalog=${sqlDatabaseName};Encrypt=True;TrustServerCertificate=False;Authentication=Active Directory Managed Identity;Connection Timeout=30;' }
        { name: 'Media__BlobServiceUri', value: 'https://${storageName}.blob.${environment().suffixes.storage}/' }
        { name: 'Media__ContainerName', value: 'media' }
        { name: 'ApplicationInsights__ConnectionString', value: monitoring.properties.ConnectionString }
        { name: 'WEBSITE_ENABLE_SYNC_UPDATE_SITE', value: 'true' }
      ]
    }
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  tags: { environment: environmentName, application: 'DaqqaTid' }
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: 'daqqa-bootstrap-admin'
    administratorLoginPassword: sqlAdminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  tags: { environment: environmentName, application: 'DaqqaTid' }
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: 2147483648
    readScale: 'Disabled'
    zoneRedundant: false
  }
}

resource sqlFirewall 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource sqlEntraAdmin 'Microsoft.Sql/servers/administrators@2023-08-01-preview' = if (!empty(sqlEntraAdminObjectId)) {
  parent: sqlServer
  name: 'ActiveDirectory'
  properties: {
    administratorType: 'ActiveDirectory'
    login: sqlEntraAdminName
    sid: sqlEntraAdminObjectId
    tenantId: subscription().tenantId
  }
}


resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  tags: { environment: environmentName, application: 'DaqqaTid' }
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    networkAcls: { defaultAction: 'Allow', bypass: 'AzureServices' }
  }
}

resource storageBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, app.id, 'Storage Blob Data Contributor')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}
resource mediaContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'media'
  properties: { publicAccess: 'None' }
}

resource monitoring 'Microsoft.Insights/components@2020-02-02' = {
  tags: { environment: environmentName, application: 'DaqqaTid' }
  name: '${webAppName}-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logWorkspace.id
  }
}
resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  tags: { environment: environmentName, application: 'DaqqaTid' }
  name: '${webAppName}-logs'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

output webAppUrl string = 'https://${app.properties.defaultHostName}'
output appPrincipalId string = app.identity.principalId
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output storageAccountName string = storage.name
