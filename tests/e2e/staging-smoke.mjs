// Run only against the explicitly isolated Staging demo. Never print credentials.
import assert from 'node:assert/strict';
import { request } from '@playwright/test';

const origin = new URL(process.env.STAGING_SMOKE_URL || 'https://missing.invalid');
const email = process.env.STAGING_ADMIN_EMAIL;
const password = process.env.STAGING_ADMIN_PASSWORD;
if (origin.protocol !== 'https:' || origin.hostname === 'missing.invalid' || origin.pathname !== '/' || origin.username || origin.password || !email || !password)
  throw new Error('Set HTTPS STAGING_SMOKE_URL and protected STAGING_ADMIN_EMAIL / STAGING_ADMIN_PASSWORD credentials for the isolated demo.');

const contexts = [];
async function actor(credentials) {
  const api = await request.newContext({ baseURL: origin.origin, maxRedirects: 0 });
  contexts.push(api);
  let session = await ok(await api.get('/api/session'));
  assert.equal(session.stagingDemoEnabled, true, 'Refusing to write: target is not the isolated staging demo.');
  assert.equal(session.demoEnabled, false, 'Development persona access must be disabled.');
  let csrf = session.csrfToken;
  const post = async (path, body) => ok(await api.post(path, { headers: { 'X-CSRF-TOKEN': csrf }, data: body }));
  await post('/api/auth/login', credentials);
  session = await ok(await api.get('/api/session'));
  csrf = session.csrfToken;
  const upload = async (path, multipart) => ok(await api.post(path, { headers: { 'X-CSRF-TOKEN': csrf }, multipart }));
  return { api, post, upload, user: session.user };
}
async function ok(response) {
  // Error bodies can contain submitted data; log only path and HTTP status.
  assert.ok(response.ok(), `HTTP ${response.status()} for ${new URL(response.url()).pathname}`);
  return response.json();
}

try {
  const admin = await actor({ email, password });
  assert.equal(admin.user.role, 'Admin');
  const health = await admin.api.get('/health/ready');
  assert.equal(health.status(), 200, 'Database readiness failed.');
  assert.equal(health.headers()['x-robots-tag'], 'noindex, nofollow');
  const robots = await admin.api.get('/robots.txt');
  assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
  assert.equal((await admin.api.get('/sitemap.xml')).status(), 404);
  const fixture = await admin.post('/api/admin/staging-demo/fixture', {});
  const customer = await actor(fixture.customer);
  const worker = await actor(fixture.worker);
  const profile = await ok(await customer.api.get(`/api/workers/${fixture.workerId}`));
  assert.equal(profile.isDemo, true);
  const startAt = new Date();
  startAt.setUTCDate(startAt.getUTCDate() + 2);
  startAt.setUTCHours(10, 0, 0, 0);
  let booking = await customer.post('/api/bookings', {
    workerId: fixture.workerId, categoryId: fixture.categoryId, mode: 'ForMe',
    summary: 'Fictional staging smoke request', description: 'Test only; no real service or money.',
    address: 'Fictional staging address', locality: 'Mosta', startAt: startAt.toISOString(),
    durationMinutes: 60, isAsap: false, idempotencyKey: `staging-smoke-${fixture.runId}`
  });
  const id = booking.id;
  for (const [person, action, status] of [[worker, 'accept', 'WorkerAccepted'], [customer, 'confirm', 'Confirmed'], [worker, 'start', 'InProgress'], [worker, 'complete', 'Completed']]) {
    booking = await person.post(`/api/bookings/${id}/action`, { action });
    assert.equal(booking.status, status);
    assert.equal(booking.isSimulated, true);
  }
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZtV8AAAAASUVORK5CYII=', 'base64');
  const media = await customer.upload('/api/media', {
    purpose: 'booking', bookingId: id,
    file: { name: 'fictional-staging.png', mimeType: 'image/png', buffer: bytes },
  });
  const photo = await worker.api.get(media.url);
  assert.equal(photo.status(), 200, 'Assigned worker cannot read the private booking photo.');
  assert.deepEqual(await photo.body(), bytes);
  assert.match(photo.headers()['cache-control'] ?? '', /no-store/);
  const anonymous = await request.newContext({ baseURL: origin.origin, maxRedirects: 0 });
  contexts.push(anonymous);
  assert.equal((await anonymous.get(media.url)).status(), 404, 'Private booking photo is visible anonymously.');
  await customer.post(`/api/bookings/${id}/review`, { rating: 5, comment: 'Fictional staging smoke test review.' });
  const payments = await ok(await admin.api.get('/api/admin/payments'));
  assert.equal(payments.filter(p => p.bookingId === id && p.isSimulated === true).length, 1);
  console.log(`Staging smoke passed: booking ${id} completed; private photo, one simulated payment and review verified.`);
} finally {
  await Promise.all(contexts.map(context => context.dispose()));
}
