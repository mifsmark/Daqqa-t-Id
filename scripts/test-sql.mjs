import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sdk=existsSync('/workspace/.dotnet/dotnet')?'/workspace/.dotnet/dotnet':'dotnet';
const toolEnv=existsSync('/workspace/.dotnet/dotnet')?{DOTNET_CLI_HOME:'/workspace/.dotnet-home',NUGET_PACKAGES:'/workspace/.nuget/packages'}:{};
const read=spawnSync('docker',['compose','-f','compose.yml','config','--format','json'],{cwd:root,encoding:'utf8'});
if(read.status!==0)process.exit(read.status??1);
const cfg=JSON.parse(read.stdout);
// Every local run gets a fresh disposable catalog so schema changes are checked
// through reviewed migrations without resetting a retained development database.
const catalog='DaqqaTid_Tests_'+randomUUID().replaceAll('-','');
const connection=cfg.services.app.environment.ConnectionStrings__DefaultConnection.replace('Server=sql,1433','Server=127.0.0.1,1433').replace('Database=DaqqaTid;','Database='+catalog+';');
const child=spawnSync(sdk,['test','tests/DaqqaTid.IntegrationTests/DaqqaTid.IntegrationTests.csproj','--configuration','Release','--nologo'],{cwd:root,stdio:'inherit',env:{...process.env,...toolEnv,TEST_SQL_CONNECTION:process.env.TEST_SQL_CONNECTION??connection}});
process.exit(child.status??1);
