#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const target = process.argv[2];
if (target !== 'staging' && target !== 'production') {
  console.error('Usage: node scripts/check-cloudflare-config.mjs staging|production');
  process.exit(2);
}

const config = JSON.parse(readFileSync(new URL('../src/cloudflare/wrangler.jsonc', import.meta.url), 'utf8'));
const env = config.env?.[target];
const database = env?.d1_databases?.find(binding => binding.binding === 'DB');
const media = env?.kv_namespaces?.find(binding => binding.binding === 'MEDIA');
const origin = env?.vars?.PUBLIC_ORIGIN;
const placeholders = [
  !database || database.database_id === '00000000-0000-0000-0000-000000000001',
  !media || media.id === '00000000000000000000000000000001',
  !origin || origin.includes('<') || origin.includes('your-domain'),
];
if (target === 'production') {
  placeholders[0] ||= database?.database_id === '11111111-1111-1111-1111-111111111111';
  placeholders[1] ||= media?.id === '11111111111111111111111111111111';
  placeholders[2] ||= env.vars.STAGING_DEMO_ENABLED !== 'false';
} else {
  placeholders[2] ||= env.vars.ENVIRONMENT !== 'staging'
    || env.vars.STAGING_DEMO_ENABLED !== 'true'
    || !database.database_name.endsWith('_staging_demo')
    || env.vars.STAGING_DEMO_DATABASE_NAME !== database.database_name;
}

if (placeholders.some(Boolean)) {
  console.error(`Cloudflare ${target} config still has placeholder values or an invalid environment guard. Update that environment's D1/KV IDs and PUBLIC_ORIGIN before deployment.`);
  process.exit(1);
}
