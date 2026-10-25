import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { Actor, bookingRequest, futureStartAt, registeredActor, registeredAdmin, createWorker, json } from './helpers';

describe('security and eligibility D1 integration', () => {
  it('enforces authentication, role authorization, and CSRF on cookie-authenticated writes', async () => {
    const anonymous = new Actor();
    expect((await anonymous.request('/api/me')).status).toBe(401);

    const noCsrf = await anonymous.request('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: anonymous.email, password: anonymous.password, displayName: 'No token', phone: '', locality: 'Mosta', role: 'Customer' }),
    });
    expect(noCsrf.status).toBe(400);

    const customer = await registeredActor();
    expect((await customer.request('/api/admin/users')).status).toBe(403);
    expect((await customer.mutate('/api/me/privacy-request', { kind: 'Export' })).status).toBe(200);
    const { response: sessionResponse, body: session } = await customer.json('/api/session');
    expect(sessionResponse.status).toBe(200);
    expect(session.user.role).toBe('Customer');
  });

  it('preserves verified status on resubmission and blocks a suspended worker', async () => {
    const worker = await registeredActor('Worker');
    const workerId = await createWorker(worker);
    const admin = await registeredAdmin();

    expect((await worker.mutate('/api/worker/verification', { reference: 'TEST-REG-1', notes: 'First review' })).status).toBe(200);
    const approved = await admin.mutate(`/api/admin/workers/${workerId}/verification`, { status: 'Verified' });
    expect(approved.status).toBe(200);
    expect((await json(approved)).verificationStatus).toBe('Verified');

    const resubmitted = await worker.mutate('/api/worker/verification', { reference: 'TEST-REG-2', notes: 'Updated evidence' });
    expect(resubmitted.status).toBe(200);
    expect((await json(resubmitted)).verificationStatus).toBe('Verified');

    const suspended = await admin.mutate(`/api/admin/workers/${workerId}/verification`, { status: 'Suspended' });
    expect(suspended.status).toBe(200);
    const blocked = await worker.mutate('/api/worker/verification', { reference: 'TEST-REG-3', notes: 'Must not change state' });
    expect(blocked.status).toBe(403);
    const persisted = await env.DB.prepare('SELECT verification_status FROM workers WHERE id=?').bind(workerId).first<{ verification_status: string }>();
    expect(persisted?.verification_status).toBe('Suspended');
  });

  it('keeps booking media private to the owning customer and assigned worker', async () => {
    const customer = await registeredActor();
    const otherCustomer = await registeredActor();
    const worker = await registeredActor('Worker');
    const workerId = await createWorker(worker, { pricingType: 'Hourly' });
    const bookingResponse = await customer.mutate('/api/bookings', bookingRequest(workerId, 'ForMe', { startAt: futureStartAt(3) }));
    expect(bookingResponse.status, await bookingResponse.clone().text()).toBe(200);
    const booking = await json(bookingResponse);

    const beforeConfirm = await json(await worker.request(`/api/bookings/${booking.id}`));
    expect(beforeConfirm.address).toBeNull();
    expect((await worker.mutate(`/api/bookings/${booking.id}/action`, { action: 'accept' })).status).toBe(200);
    expect((await customer.mutate(`/api/bookings/${booking.id}/action`, { action: 'confirm' })).status).toBe(200);
    expect((await json(await worker.request(`/api/bookings/${booking.id}`))).address).toBe('17 Private Lane');

    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII='), char => char.charCodeAt(0));
    const form = new FormData();
    form.set('purpose', 'booking');
    form.set('bookingId', booking.id);
    form.set('file', new File([bytes], 'fixture.png', { type: 'image/png' }));
    const upload = await customer.request('/api/media', { method: 'POST', body: form, headers: { 'X-CSRF-TOKEN': customer.csrfToken } });
    expect(upload.status).toBe(201);
    const media = await json(upload);
    expect((await worker.request(`/api/media/${media.id}`)).status).toBe(200);
    expect((await otherCustomer.request(`/api/media/${media.id}`)).status).toBe(404);
  });
});
