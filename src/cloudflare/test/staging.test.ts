import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/types';
import { json, registeredAdmin } from './helpers';

describe('staging demo deployment gate', () => {
  it('keeps the controlled fixture disabled in the default development binding set', async () => {
    expect(env.ENVIRONMENT).toBe('development');
    expect(env.STAGING_DEMO_ENABLED).toBe('false');
    const admin = await registeredAdmin();
    const response = await admin.mutate('/api/admin/staging-demo/fixture', {});
    expect(response.status).toBe(404);
  });

  it('creates a fixture only with staging bindings and the exact matching D1 deployment markers', async () => {
    const admin = await registeredAdmin();
    const bindings: Env = {
      DB: env.DB,
      MEDIA: env.MEDIA,
      ASSETS: env.ASSETS,
      PUBLIC_ORIGIN: env.PUBLIC_ORIGIN,
      ENVIRONMENT: 'staging',
      STAGING_DEMO_ENABLED: 'true',
      STAGING_DEMO_DATABASE_NAME: 'test_staging_demo',
    };
    const previous = await env.DB.prepare("SELECT key,value FROM deployment_info WHERE key IN ('database_name','environment')")
      .all<{ key: string; value: string }>();
    const oldMarkers = new Map(previous.results.map(row => [row.key, row.value]));
    await env.DB.batch([
      env.DB.prepare("INSERT OR REPLACE INTO deployment_info(key,value) VALUES ('database_name',?)").bind(bindings.STAGING_DEMO_DATABASE_NAME),
      env.DB.prepare("INSERT OR REPLACE INTO deployment_info(key,value) VALUES ('environment','staging')"),
    ]);
    let fixture: Record<string, any> = {};
    try {
      const mismatchedBindings: Env = { ...bindings, STAGING_DEMO_DATABASE_NAME: 'mismatched_staging_demo' };
      const mismatch = await admin.requestWith('/api/admin/staging-demo/fixture', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': admin.csrfToken }, body: '{}',
      }, request => worker.fetch(request, mismatchedBindings));
      expect(mismatch.status).toBe(404);

      const response = await admin.requestWith('/api/admin/staging-demo/fixture', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': admin.csrfToken }, body: '{}',
      }, request => worker.fetch(request, bindings));
      expect(response.status).toBe(201);
      fixture = await json(response);
      expect(fixture.runId).toBeTruthy();
      expect(fixture.workerId).toBeTruthy();
      expect(fixture.customer.email).toContain('.customer@example.invalid');
      expect(fixture.worker.email).toContain('.worker@example.invalid');
      expect(fixture.customer.password).toBeTruthy();
      expect(fixture.worker.password).toBeTruthy();

      const demoWorker = await env.DB.prepare('SELECT is_demo FROM workers WHERE id=?').bind(fixture.workerId).first<{ is_demo: number }>();
      expect(demoWorker?.is_demo).toBe(1);

      const productionBindings: Env = { ...bindings, ENVIRONMENT: 'production' };
      const productionResponse = await admin.requestWith('/api/admin/staging-demo/fixture', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': admin.csrfToken }, body: '{}',
      }, request => worker.fetch(request, productionBindings));
      expect(productionResponse.status).toBe(404);

    } finally {
      for (const email of [fixture.customer?.email, fixture.worker?.email].filter((value): value is string => typeof value === 'string'))
        await env.DB.prepare('DELETE FROM users WHERE email=?').bind(email).run();
      if (typeof fixture.runId === 'string') {
        await env.DB.prepare("DELETE FROM audit_entries WHERE action='staging-demo.fixture.created' AND details_json LIKE ?")
          .bind(`%${fixture.runId}%`).run();
      }
      await env.DB.prepare("DELETE FROM deployment_info WHERE key IN ('database_name','environment')").run();
      for (const [key, value] of oldMarkers) await env.DB.prepare('INSERT INTO deployment_info(key,value) VALUES (?,?)').bind(key, value).run();
    }
  });
});
