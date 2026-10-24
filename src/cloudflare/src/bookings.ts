import type { Context, ExceptionRow, HourRow, WorkerRow } from './types';
import { requireActor } from './auth';
import { choice, euroToCents, HttpError, json, numeric, readJson, rows, sha256, text, uuid } from './http';
import { distanceKm, isAvailableAt, resolveStartAt, validEnd } from './booking-rules';

interface BookingRow {
  id: string; customer_id: string; worker_id: string; category_id: string; worker_user_id: string;
  worker_name: string; customer_name: string; category_name: string; mode: string;
  summary: string; description: string; locality: string; private_address: string;
  start_at: string; end_at: string; status: string; pricing_type: string;
  amount_cents: number | null; commission_cents: number | null; quote_amount_cents: number | null;
  idempotency_key: string; request_fingerprint: string; version: number; is_asap: number;
}
const selectBooking = `SELECT b.*,w.user_id worker_user_id,u.display_name worker_name,cu.display_name customer_name,c.name category_name
  FROM bookings b JOIN workers w ON w.id=b.worker_id JOIN users u ON u.id=w.user_id
  JOIN users cu ON cu.id=b.customer_id JOIN categories c ON c.id=b.category_id`;
const transitions: Record<string, string[]> = {
  Requested: ['Quoted', 'WorkerAccepted', 'Cancelled', 'Expired'], Quoted: ['Confirmed', 'Cancelled', 'Expired'],
  WorkerAccepted: ['Confirmed', 'Cancelled', 'Expired'], Confirmed: ['InProgress', 'Cancelled'], InProgress: ['Completed'], Completed: [], Cancelled: [], Expired: [],
};
const reserved = "('WorkerAccepted','Confirmed','InProgress')";

function owner(c: Context, booking: BookingRow): void {
  const actor = requireActor(c);
  if (actor.role === 'Admin' || (actor.role === 'Customer' && booking.customer_id === actor.id)
    || (actor.role === 'Worker' && booking.worker_user_id === actor.id)) return;
  throw new HttpError(403, 'This booking belongs to another account.');
}
async function booking(c: Context, id: string): Promise<BookingRow> {
  const result = await c.env.DB.prepare(`${selectBooking} WHERE b.id=?`).bind(id).first<BookingRow>();
  if (!result) throw new HttpError(404, 'Booking not found.');
  owner(c, result); return result;
}
function scope(c: Context): { sql: string; args: string[] } {
  const actor = requireActor(c);
  return actor.role === 'Admin' ? { sql: '1=1', args: [] } : actor.role === 'Worker'
    ? { sql: 'w.user_id=?', args: [actor.id] } : { sql: 'b.customer_id=?', args: [actor.id] };
}
export async function bookingViews(c: Context, id?: string): Promise<unknown[]> {
  const filter = scope(c);
  const where = `${filter.sql}${id ? ' AND b.id=?' : ''}`;
  const args = [...filter.args, ...(id ? [id] : [])];
  const list = await rows<BookingRow>(c.env.DB.prepare(`${selectBooking} WHERE ${where} ORDER BY b.start_at DESC`).bind(...args));
  const history = await rows<{ booking_id: string; status: string; at: string }>(c.env.DB.prepare(`SELECT h.booking_id,h.status,h.at FROM booking_history h JOIN bookings b ON b.id=h.booking_id JOIN workers w ON w.id=b.worker_id WHERE ${where} ORDER BY h.at,h.rowid`).bind(...args));
  const reviews = await rows<{ booking_id: string; id: string; rating: number; comment: string; created_at: string }>(c.env.DB.prepare(`SELECT r.* FROM reviews r JOIN bookings b ON b.id=r.booking_id JOIN workers w ON w.id=b.worker_id WHERE ${where}`).bind(...args));
  return list.map(b => {
    const review = reviews.find(r => r.booking_id === b.id);
    return { id: b.id, customerId: b.customer_id, workerId: b.worker_id, workerName: b.worker_name, customerName: b.customer_name,
      categoryId: b.category_id, categoryName: b.category_name, mode: b.mode, summary: b.summary, description: b.description, locality: b.locality,
      address: c.actor!.role !== 'Worker' || ['Confirmed', 'InProgress', 'Completed'].includes(b.status) ? b.private_address : null,
      startAt: b.start_at, endAt: b.end_at, status: b.status, pricingType: b.pricing_type,
      amount: b.amount_cents === null ? null : b.amount_cents / 100,
      commissionAmount: b.commission_cents === null ? null : b.commission_cents / 100,
      quoteAmount: b.quote_amount_cents === null ? null : b.quote_amount_cents / 100, isSimulated: true,
      history: history.filter(h => h.booking_id === b.id).map(h => ({ status: h.status, at: h.at })),
      review: review ? { id: review.id, rating: review.rating, comment: review.comment, createdAt: review.created_at } : null };
  });
}
async function view(c: Context, id: string): Promise<Response> {
  const result = (await bookingViews(c, id))[0];
  if (!result) throw new HttpError(404, 'Booking not found.');
  return json(result);
}
async function workerSnapshot(c: Context, workerId: string, locality: string, start: Date, end: Date): Promise<WorkerRow> {
  const worker = await c.env.DB.prepare(`SELECT w.*,u.display_name,u.is_suspended FROM workers w JOIN users u ON u.id=w.user_id WHERE w.id=?`).bind(workerId).first<WorkerRow & { is_suspended: number }>();
  if (!worker) throw new HttpError(404, 'Worker not found.');
  if (worker.is_suspended || worker.verification_status === 'Suspended') throw new HttpError(409, 'Worker is unavailable.');
  const hours = await rows<HourRow>(c.env.DB.prepare('SELECT * FROM weekly_hours WHERE worker_id=?').bind(workerId));
  const exceptions = await rows<ExceptionRow>(c.env.DB.prepare('SELECT * FROM availability_exceptions WHERE worker_id=?').bind(workerId));
  if (!isAvailableAt(hours, exceptions, start, end)) throw new HttpError(409, 'Worker is not available for the requested time.');
  const places = await rows<{ name: string; latitude: number; longitude: number }>(c.env.DB.prepare('SELECT * FROM localities WHERE name=? OR name=?').bind(locality, worker.locality));
  const origin = places.find(p => p.name === locality), destination = places.find(p => p.name === worker.locality);
  if (!origin || !destination || distanceKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude) > worker.radius_km)
    throw new HttpError(409, 'Worker does not serve this locality.');
  return worker;
}
async function create(c: Context): Promise<Response> {
  const actor = requireActor(c, ['Customer']); const input = await readJson(c.request);
  const workerId = uuid(input.workerId), categoryId = uuid(input.categoryId);
  const mode = choice(input.mode, ['ForMe', 'WithMe', 'TeachMe'] as const, 'service mode');
  const summary = text(input.summary, 'Summary', 200, 2), description = text(input.description ?? '', 'Description', 4000);
  const address = text(input.address, 'Address', 500, 2), locality = text(input.locality, 'Locality', 100, 1);
  const key = text(input.idempotencyKey, 'Idempotency key', 120, 1);
  const requestedStart = text(input.startAt, 'Start time', 50, 1);
  const duration = numeric(input.durationMinutes, 'Duration', 15, 720);
  if (typeof input.isAsap !== 'boolean') throw new HttpError(400, 'Choose ASAP or a scheduled request.');
  const fingerprint = await sha256(JSON.stringify([workerId, categoryId, mode, summary, description, address, locality, requestedStart, duration, input.isAsap]));
  const prior = await c.env.DB.prepare('SELECT id,request_fingerprint FROM bookings WHERE customer_id=? AND idempotency_key=?').bind(actor.id, key).first<{ id: string; request_fingerprint: string }>();
  if (prior) {
    if (prior.request_fingerprint !== fingerprint) throw new HttpError(409, 'Idempotency key was used for a different request.');
    return view(c, prior.id);
  }
  const start = resolveStartAt(requestedStart, input.isAsap, c.now), end = validEnd(start, duration, c.now);
  const worker = await workerSnapshot(c, workerId, locality, start, end);
  if (input.isAsap && !worker.available_now) throw new HttpError(409, 'Worker is not currently available.');
  const offering = await c.env.DB.prepare('SELECT pricing_type,price_cents FROM offerings WHERE worker_id=? AND category_id=?').bind(workerId, categoryId).first<{ pricing_type: string; price_cents: number | null }>();
  if (!offering) throw new HttpError(409, 'Worker does not offer this service.');
  const rate = offering.price_cents ?? worker.hourly_rate_cents;
  const amount = offering.pricing_type === 'Quote' ? null : offering.pricing_type === 'Fixed' ? rate : Math.round(rate * duration / 60);
  const id = crypto.randomUUID(), now = c.now.toISOString();
  try {
    const inserted = await c.env.DB.prepare(`INSERT INTO bookings (id,customer_id,worker_id,category_id,mode,summary,description,locality,private_address,start_at,end_at,status,pricing_type,amount_cents,is_asap,idempotency_key,request_fingerprint,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,'Requested',?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workers WHERE id=? AND version=?) RETURNING id`)
      .bind(id, actor.id, workerId, categoryId, mode, summary, description, locality, address, start.toISOString(), end.toISOString(), offering.pricing_type, amount, input.isAsap ? 1 : 0, key, fingerprint, now, now, workerId, worker.version).first();
    if (!inserted) throw new HttpError(409, 'Worker availability changed. Refresh and try again.');
  } catch (error) {
    const repeated = await c.env.DB.prepare('SELECT id,request_fingerprint FROM bookings WHERE customer_id=? AND idempotency_key=?').bind(actor.id, key).first<{ id: string; request_fingerprint: string }>();
    if (repeated?.request_fingerprint === fingerprint) return view(c, repeated.id);
    throw error;
  }
  return view(c, id);
}
async function act(c: Context, id: string): Promise<Response> {
  const b = await booking(c, id), actor = requireActor(c), input = await readJson(c.request);
  const action = text(input.action, 'Action', 20, 1).toLowerCase();
  const isWorker = actor.role === 'Worker' && b.worker_user_id === actor.id, isCustomer = actor.role === 'Customer' && b.customer_id === actor.id;
  let to: string;
  if (isWorker && action === 'accept') to = 'WorkerAccepted';
  else if (isWorker && action === 'quote') to = 'Quoted';
  else if (isWorker && action === 'start') to = 'InProgress';
  else if (isWorker && action === 'complete') to = 'Completed';
  else if (isCustomer && action === 'confirm') to = 'Confirmed';
  else if ((isWorker && action === 'decline') || ((isWorker || isCustomer) && action === 'cancel')) to = 'Cancelled';
  else throw new HttpError(403, 'Action is not allowed.');
  if (!transitions[b.status].includes(to)) throw new HttpError(409, `Cannot move a booking from ${b.status} to ${to}.`);
  if (to === 'WorkerAccepted' && b.pricing_type === 'Quote') throw new HttpError(409, 'Send a quote for this request.');
  const quoted = action === 'quote' ? euroToCents(input.amount, 'Quote') : b.quote_amount_cents;
  if (action === 'quote' && !quoted) throw new HttpError(400, 'A positive quote is required.');
  const amount = action === 'quote' ? quoted : b.amount_cents;
  if (to === 'Confirmed' && (amount === null || (b.pricing_type === 'Quote' && quoted === null))) throw new HttpError(409, 'Worker must provide a price first.');
  let workerVersion: number | null = null;
  if (to === 'WorkerAccepted' || to === 'Confirmed') {
    if (new Date(b.start_at).valueOf() <= c.now.valueOf()) throw new HttpError(409, 'Booking start time has passed.');
    const worker = await workerSnapshot(c, b.worker_id, b.locality, new Date(b.start_at), new Date(b.end_at));
    workerVersion = worker.version;
  }
  const settings = to === 'Completed' ? await c.env.DB.prepare('SELECT commission_bps FROM settings WHERE id=1').first<{ commission_bps: number }>() : null;
  const commission = to === 'Completed' ? Math.round((amount ?? 0) * (settings?.commission_bps ?? 1200) / 10000) : b.commission_cents;
  const updated = await c.env.DB.prepare(`UPDATE bookings SET status=?,amount_cents=?,quote_amount_cents=?,commission_cents=?,version=version+1,updated_at=? WHERE id=? AND version=?
    ${workerVersion === null ? '' : 'AND EXISTS (SELECT 1 FROM workers WHERE id=bookings.worker_id AND version=?)'} RETURNING id`)
    .bind(to, amount, quoted, commission, c.now.toISOString(), id, b.version, ...(workerVersion === null ? [] : [workerVersion])).first();
  if (!updated) throw new HttpError(409, 'Booking or worker availability changed. Refresh and try again.');
  return view(c, id);
}
async function review(c: Context, id: string): Promise<Response> {
  const actor = requireActor(c, ['Customer']), b = await booking(c, id), input = await readJson(c.request);
  if (b.customer_id !== actor.id) throw new HttpError(403, 'This booking belongs to another account.');
  if (b.status !== 'Completed') throw new HttpError(409, 'Only completed bookings can be reviewed.');
  const rating = numeric(input.rating, 'Rating', 1, 5), comment = text(input.comment ?? '', 'Comment', 2000);
  if (!Number.isInteger(rating)) throw new HttpError(400, 'Choose a whole-number rating.');
  const reviewId = crypto.randomUUID(), now = c.now.toISOString();
  await c.env.DB.prepare('INSERT INTO reviews (id,booking_id,customer_id,worker_id,rating,comment,created_at) VALUES (?,?,?,?,?,?,?)').bind(reviewId, id, actor.id, b.worker_id, rating, comment, now).run();
  return json({ id: reviewId, bookingId: id, customerId: actor.id, workerId: b.worker_id, rating, comment, createdAt: now });
}
export async function handleBookings(c: Context): Promise<Response | undefined> {
  const path = c.url.pathname, method = c.request.method;
  if (path === '/api/bookings') {
    if (method === 'GET') return json(await bookingViews(c));
    if (method === 'POST') return create(c);
  }
  const match = path.match(/^\/api\/bookings\/([0-9a-f-]{36})(?:\/(action|review))?$/i);
  if (!match) return;
  const id = uuid(match[1]);
  if (!match[2] && method === 'GET') { await booking(c, id); return view(c, id); }
  if (match[2] === 'action' && method === 'POST') return act(c, id);
  if (match[2] === 'review' && method === 'POST') return review(c, id);
}
