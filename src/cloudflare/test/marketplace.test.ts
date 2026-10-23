import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { Actor, bookingRequest, createWorker, futureStartAt, json, registeredActor, CLEANING_CATEGORY_ID } from './helpers';

describe('marketplace D1 integration', () => {
  it('runs ForMe direct and WithMe/TeachMe quote lifecycles with private address and one simulated payment', async () => {
    const customer = await registeredActor();
    const worker = await registeredActor('Worker');
    const otherCustomer = await registeredActor();
    const workerId = await createWorker(worker, { pricingType: 'Hourly' });

    const forMeRequest = bookingRequest(workerId, 'ForMe', {
      summary: 'Repair a loose shelf',
      startAt: futureStartAt(4),
    });
    const create = await customer.mutate('/api/bookings', forMeRequest);
    expect(create.status, await create.clone().text()).toBe(200);
    const booking = await json(create);
    expect(booking.status).toBe('Requested');
    expect(booking.address).toBe('17 Private Lane');

    const retry = await customer.mutate('/api/bookings', forMeRequest);
    expect(retry.status).toBe(200);
    expect((await json(retry)).id).toBe(booking.id);
    expect((await otherCustomer.request(`/api/bookings/${booking.id}`)).status).toBe(403);
    expect((await json(await worker.request(`/api/bookings/${booking.id}`))).address).toBeNull();

    for (const action of ['accept', 'confirm', 'start', 'complete']) {
      const actor = action === 'confirm' ? customer : worker;
      const response = await actor.mutate(`/api/bookings/${booking.id}/action`, { action });
      expect(response.status, `${action}: ${await response.clone().text()}`).toBe(200);
    }
    const review = await customer.mutate(`/api/bookings/${booking.id}/review`, { rating: 5, comment: 'Clear and helpful.' });
    expect(review.status).toBe(200);
    expect((await customer.mutate(`/api/bookings/${booking.id}/review`, { rating: 5, comment: 'Duplicate' })).status).toBe(409);

    const quoteWorkerId = await createWorker(worker, { pricingType: 'Quote' });
    expect(quoteWorkerId).toBe(workerId);
    const withMeRequest = bookingRequest(workerId, 'WithMe', {
      summary: 'Work together on a shelf',
      startAt: futureStartAt(6),
    });
    const teachMeRequest = bookingRequest(workerId, 'TeachMe', {
      summary: 'Learn basic repairs',
      startAt: futureStartAt(8),
    });
    const withMe = await json(await customer.mutate('/api/bookings', withMeRequest));
    const teachMe = await json(await customer.mutate('/api/bookings', teachMeRequest));
    expect(withMe.status).toBe('Requested');
    expect(teachMe.status).toBe('Requested');
    for (const quoteBooking of [withMe, teachMe]) {
      const quotedResponse = await worker.mutate(`/api/bookings/${quoteBooking.id}/action`, { action: 'quote', amount: 42 });
      expect(quotedResponse.status).toBe(200);
      expect((await json(quotedResponse)).status).toBe('Quoted');
      const confirmed = await customer.mutate(`/api/bookings/${quoteBooking.id}/action`, { action: 'confirm' });
      expect(confirmed.status).toBe(200);
    }

    const payments = await env.DB.prepare('SELECT count(*) AS count FROM payments WHERE booking_id = ?').bind(booking.id).first<{ count: number }>();
    const ledger = await env.DB.prepare('SELECT count(*) AS count FROM payment_ledger WHERE payment_id = (SELECT id FROM payments WHERE booking_id = ?)').bind(booking.id).first<{ count: number }>();
    expect(payments?.count).toBe(1);
    expect(ledger?.count).toBe(2);
    const persist = await env.DB.prepare('SELECT status, is_simulated FROM bookings WHERE id = ?').bind(booking.id).first<{ status: string; is_simulated: number }>();
    expect(persist).toEqual({ status: 'Completed', is_simulated: 1 });
  });

  it('serializes conflicting accepts in SQLite so only one booking owns the time slot', async () => {
    const customer = await registeredActor();
    const secondCustomer = await registeredActor();
    const worker = await registeredActor('Worker');
    const workerId = await createWorker(worker, { pricingType: 'Hourly' });
    const startAt = futureStartAt(12);
    const firstResponse = await customer.mutate('/api/bookings', bookingRequest(workerId, 'ForMe', { startAt }));
    expect(firstResponse.status, await firstResponse.clone().text()).toBe(200);
    const first = await json(firstResponse);
    const secondResponse = await secondCustomer.mutate('/api/bookings', bookingRequest(workerId, 'ForMe', { startAt }));
    expect(secondResponse.status, await secondResponse.clone().text()).toBe(200);
    const second = await json(secondResponse);
    const responses = await Promise.all([
      worker.mutate(`/api/bookings/${first.id}/action`, { action: 'accept' }),
      worker.mutate(`/api/bookings/${second.id}/action`, { action: 'accept' }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const active = await env.DB.prepare("SELECT count(*) AS count FROM bookings WHERE worker_id = ? AND status IN ('WorkerAccepted','Confirmed','InProgress') AND start_at < ? AND ? < end_at")
      .bind(workerId, new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString(), startAt)
      .first<{ count: number }>();
    expect(active?.count).toBe(1);
  });

  it('rejects future ASAP requests, canonicalizes valid ASAP time, and excludes Malta time off from matching', async () => {
    const customer = await registeredActor();
    const worker = await registeredActor('Worker');
    const workerId = await createWorker(worker, { pricingType: 'Hourly', availableNow: true });
    const tooFar = bookingRequest(workerId, 'ForMe', {
      isAsap: true,
      startAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
    });
    expect((await customer.mutate('/api/bookings', tooFar)).status).toBe(400);

    const requestTime = Date.now();
    const asap = bookingRequest(workerId, 'ForMe', {
      isAsap: true,
      startAt: new Date(requestTime + 5 * 60 * 1000).toISOString(),
      durationMinutes: 15,
    });
    const accepted = await customer.mutate('/api/bookings', asap);
    const expectedStart = new Date(requestTime + 5 * 60 * 1000);
    const expectedEnd = new Date(expectedStart.getTime() + 15 * 60 * 1000);
    const maltaDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Malta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    if (maltaDate(expectedStart) !== maltaDate(expectedEnd)) {
      expect(accepted.status).toBe(409); // The policy rejects services that cross a Malta date boundary.
    } else {
      expect(accepted.status).toBe(200);
      const asapBooking = await json(accepted);
      const canonicalStart = Date.parse(asapBooking.startAt);
      expect(canonicalStart).toBeGreaterThanOrEqual(requestTime + 4 * 60 * 1000);
      expect(canonicalStart).toBeLessThanOrEqual(Date.now() + 6 * 60 * 1000);
    }

    const timeOffStart = futureStartAt(10);
    const maltaDateParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Malta', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(timeOffStart));
    const part = (type: string) => maltaDateParts.find(item => item.type === type)?.value;
    const timeOffDate = `${part('year')}-${part('month')}-${part('day')}`;
    const update = await worker.mutate('/api/worker/availability', {
      availableNow: false,
      windows: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:59' })),
      exceptions: [{ date: timeOffDate, isAvailable: false }],
    }, 'PUT');
    expect(update.status).toBe(200);
    const matching = await customer.request(`/api/workers?categoryId=${CLEANING_CATEGORY_ID}&mode=ForMe&locality=Mosta&startAt=${encodeURIComponent(timeOffStart)}&durationMinutes=60`);
    expect(matching.status).toBe(200);
    const workers = await matching.json() as Array<{ id: string }>;
    expect(workers.some(item => item.id === workerId)).toBe(false);
  });
});
