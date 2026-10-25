#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local development only. Never create credentials or enable demo personas in production.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
const port = Number(env.DAQQA_DEV_PORT ?? 5080);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('DAQQA_DEV_PORT must be a port from 1024 to 65535.');
const origin = `http://127.0.0.1:${port}`;
if (existsSync('/workspace/.dotnet/dotnet')) {
  env.PATH = `/workspace/.dotnet:${env.PATH}`;
  env.DOTNET_ROOT = '/workspace/.dotnet';
  env.DOTNET_CLI_HOME ??= '/workspace/.dotnet-home';
  env.NUGET_PACKAGES ??= '/workspace/.nuget/packages';
  env.npm_config_cache ??= '/tmp/daqqa-npm-cache';
}
function run(command, args, overrides = {}) {
  const result = spawnSync(command, args, { cwd: root, env: { ...env, ...overrides }, stdio: 'inherit' });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}.`);
}
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed. Check Docker Compose and the local .env configuration.`);
  return result.stdout;
}
try {
  if (!existsSync(resolve(root, '.env')) && !env.MSSQL_SA_PASSWORD) {
    writeFileSync(resolve(root, '.env'), `MSSQL_SA_PASSWORD=${randomBytes(24).toString('hex')}Aa1!\n`, { mode: 0o600, flag: 'wx' });
    console.log('Created an ignored, private local SQL password file.');
  }
  run('docker', ['compose', '-f', 'compose.yml', 'up', '-d', 'sql']);
  let healthy = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    const status = JSON.parse(capture('docker', ['compose', '-f', 'compose.yml', 'ps', '--format', 'json', 'sql']) || '{}');
    if (status.Health === 'healthy') { healthy = true; break; }
    if (status.State === 'exited') throw new Error('SQL Server exited. Inspect docker compose logs sql.');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (!healthy) throw new Error('SQL Server did not become healthy. Inspect docker compose logs sql.');
  // Capture resolved config in memory; never print connection strings or passwords.
  const config = JSON.parse(capture('docker', ['compose', '-f', 'compose.yml', 'config', '--format', 'json']));
  const connection = config.services.app.environment.ConnectionStrings__DefaultConnection.replace('Server=sql,1433', 'Server=127.0.0.1,1433');
  const localTools = resolve(root, '.local', 'dotnet-tools');
  mkdirSync(localTools, { recursive: true });
  if (!existsSync(resolve(localTools, 'dotnet-ef'))) run('dotnet', ['tool', 'install', 'dotnet-ef', '--version', '10.0.13', '--tool-path', localTools]);
  run('dotnet', ['restore', 'DaqqaTid.slnx']);
  run(resolve(localTools, 'dotnet-ef'), ['database', 'update', '--project', 'src/backend/DaqqaTid.Infrastructure', '--startup-project', 'src/backend/DaqqaTid.Api'], { ConnectionStrings__DefaultConnection: connection });
  run('npm', ['ci', '--prefix', 'src/frontend']);
  run('npm', ['run', 'build', '--prefix', 'src/frontend']);
  mkdirSync(resolve(root, 'src/backend/DaqqaTid.Api/wwwroot'), { recursive: true });
  cpSync(resolve(root, 'src/frontend/dist'), resolve(root, 'src/backend/DaqqaTid.Api/wwwroot'), { recursive: true });
  console.log('Starting the local fictional demo. Wait for the listening message; readiness is /health/ready.');
  const server = spawn('dotnet', ['run', '--project', 'src/backend/DaqqaTid.Api'], {
    cwd: root, stdio: 'inherit', env: { ...env, ConnectionStrings__DefaultConnection: connection, ASPNETCORE_ENVIRONMENT: 'Development',
      ASPNETCORE_URLS: origin, PublicOrigin: origin, Database__SeedReferenceDataOnStartup: 'true', Demo__Enabled: 'true' }
  });
  if (server.pid) writeFileSync(resolve(root, '.local', 'dev.pid'), String(server.pid), { mode: 0o600 });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.on('exit', code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Development startup failed.');
  process.exitCode = 1;
}
