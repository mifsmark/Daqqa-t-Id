import { requireActor, validateCsrf } from './auth';
import { distanceKm, isAvailableAt, resolveStartAt, validEnd } from './booking-rules';
import { choice, euroToCents, HttpError, json, numeric, readJson, rows, text, uuid } from './http';
import type { Context, ExceptionRow, HourRow, WorkerRow } from './types';

const MODES = ['ForMe', 'WithMe', 'TeachMe'] as const;
const PRICING = ['Hourly', 'Fixed', 'Quote'] as const;
const STATUSES = ['Requested', 'Quoted', 'WorkerAccepted', 'Confirmed', 'InProgress'] as const;
function mutationStamp(date: Date): string {
  const base = date.toISOString().replace(/Z$/, '');
  const suffix = crypto.getRandomValues(new Uint32Array(1))[0].toString().padStart(10, '0').slice(-10);
  return `${base}${suffix}Z`;
}

type WorkerBase = WorkerRow & {
  years_experience: number; verification_reference?: string | null; verification_notes?: string | null;
  is_demo: number; availability_updated_at: string; review_count: number; average_rating: number | null;
};
type OfferingListRow = { worker_id: string; category_id: string; modes: string; pricing_type: string; price_cents: number | null };

function summaryView(worker: WorkerBase, allOfferings: OfferingListRow[]): Record<string, unknown> {
  const offerings = allOfferings.filter(o => o.worker_id === worker.id);
  return {
    id: worker.id, userId: worker.user_id, displayName: worker.display_name, bio: worker.bio, locality: worker.locality,
    yearsExperience: worker.years_experience, verificationStatus: worker.verification_status,
    availableNow: worker.available_now === 1, availabilityUpdatedAt: worker.availability_updated_at,
    isDemo: worker.is_demo === 1, hourlyRate: worker.hourly_rate_cents / 100, pricingType: worker.pricing_type,
    categoryIds: offerings.map(o => o.category_id), modes: [...new Set(offerings.flatMap(o => o.modes ? o.modes.split(',') : []))],
    reviewCount: worker.review_count, averageRating: worker.average_rating,
  };
}

export async function getWorkerView(env: Context['env'], workerId: string, detail = false, allowSuspended = false): Promise<Record<string, unknown> | null> {
  const worker = await env.DB.prepare(`SELECT w.id,w.user_id,u.display_name,w.bio,w.locality,w.years_experience,w.radius_km,
    w.hourly_rate_cents,w.pricing_type,w.verification_status,w.available_now,w.availability_updated_at,w.is_demo,
    w.verification_reference,w.verification_notes,COUNT(DISTINCT r.id) AS review_count,AVG(r.rating) AS average_rating
    FROM workers w JOIN users u ON u.id=w.user_id LEFT JOIN reviews r ON r.worker_id=w.id
    WHERE w.id=? AND (?=1 OR w.verification_status<>'Suspended') AND u.is_suspended=0 GROUP BY w.id`).bind(workerId, allowSuspended ? 1 : 0).first<WorkerBase>();
  if (!worker) return null;
  const offerings = await rows<OfferingListRow>(env.DB.prepare(`
    SELECT o.worker_id,o.category_id,o.pricing_type,o.price_cents,group_concat(om.mode,',') AS modes
    FROM offerings o LEFT JOIN offering_modes om ON om.offering_id=o.id WHERE o.worker_id=? GROUP BY o.id ORDER BY o.category_id`).bind(workerId));
  const view = summaryView(worker, offerings);
  if (detail) {
    const hours = await rows<{ id: string; weekday: number; start_time: string; end_time: string }>(env.DB.prepare('SELECT id,weekday,start_time,end_time FROM weekly_hours WHERE worker_id=? ORDER BY weekday,start_time').bind(workerId));
    const reviews = await rows<{ id: string; rating: number; comment: string; customer_name: string; created_at: string }>(env.DB.prepare(`
      SELECT r.id,r.rating,r.comment,u.display_name AS customer_name,r.created_at FROM reviews r JOIN users u ON u.id=r.customer_id
      WHERE r.worker_id=? ORDER BY r.created_at DESC`).bind(workerId));
    view.radiusKm = worker.radius_km;
    view.offerings = offerings.map(o => ({ categoryId: o.category_id, modes: o.modes ? o.modes.split(',') : [], pricingType: o.pricing_type, price: o.price_cents === null ? null : o.price_cents / 100 }));
    view.availability = hours.map(h => ({ id: h.id, dayOfWeek: h.weekday, startTime: h.start_time, endTime: h.end_time }));
    view.reviews = reviews.map(r => ({ id: r.id, rating: r.rating, comment: r.comment, customerName: r.customer_name, createdAt: r.created_at }));
  }
  return view;
}

export async function handleCatalog(c: Context): Promise<Response | undefined> {
  const { pathname: path } = c.url;
  const method = c.request.method;
  if (path === '/api/catalog' && method === 'GET') return getCatalog(c);
  if (path === '/api/localities' && method === 'GET') return json(await rows(c.env.DB.prepare('SELECT name,latitude,longitude FROM localities ORDER BY name')));
  if (path === '/api/workers' && method === 'GET') return listWorkers(c);
  const workerDetail = path.match(/^\/api\/workers\/([^/]+)$/);
  if (workerDetail && method === 'GET') {
    const id = uuid(workerDetail[1]);
    const view = await getWorkerView(c.env, id, true);
    return view ? json(view) : json({ title: 'Not found', status: 404 }, 404);
  }
  if (path === '/api/me' && method === 'GET') return me(c);
  if (path === '/api/me' && method === 'PUT') return updateMe(c);
  if (path === '/api/me/addresses' && method === 'GET') return addresses(c);
  if (path === '/api/me/addresses' && method === 'POST') return addAddress(c);
  const addressDelete = path.match(/^\/api\/me\/addresses\/([^/]+)$/);
  if (addressDelete && method === 'DELETE') return deleteAddress(c, addressDelete[1]);
  if (path === '/api/worker/profile' && method === 'GET') return workerProfile(c);
  if (path === '/api/worker/profile' && method === 'PUT') return updateWorkerProfile(c);
  if (path === '/api/worker/availability' && method === 'PUT') return updateAvailability(c);
  if (path === '/api/worker/verification' && method === 'POST') return submitVerification(c);
  return undefined;
}

async function getCatalog(c: Context): Promise<Response> {
  const categories = await rows<{ id: string; slug: string; name: string; description: string; icon: string; requires_verification: number; is_active: number }>(c.env.DB.prepare('SELECT id,slug,name,description,icon,requires_verification,is_active FROM categories ORDER BY name'));
  const modes = await rows<{ category_id: string; mode: string }>(c.env.DB.prepare('SELECT category_id,mode FROM category_modes ORDER BY mode'));
  return json(categories.map(x => ({ id: x.id, slug: x.slug, name: x.name, description: x.description, icon: x.icon,
    modes: modes.filter(m => m.category_id === x.id).map(m => m.mode), requiresVerification: x.requires_verification === 1, isActive: x.is_active === 1 })));
}

async function listWorkers(c: Context): Promise<Response> {
  const p = c.url.searchParams;
  const categoryId = p.get('categoryId');
  const mode = p.get('mode');
  if (categoryId) uuid(categoryId);
  if (mode) choice(mode, MODES, 'mode');
  const locality = p.get('locality')?.trim() || '';
  const availableOnly = p.get('availableNow') === 'true';
  const maxPriceText = p.get('maxPrice');
  const maxPrice = maxPriceText === null ? null : Number(maxPriceText);
  if (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0 || maxPrice > 100000)) throw new HttpError(400, 'maxPrice is invalid.');
  const startText = p.get('startAt');
  const durationText = p.get('durationMinutes');
  const duration = durationText === null ? 60 : Number(durationText);
  if ((startText || availableOnly) && (!Number.isInteger(duration) || duration < 15 || duration > 720)) throw new HttpError(400, 'durationMinutes must be between 15 and 720.');
  const category = categoryId ? await c.env.DB.prepare('SELECT id,is_active,requires_verification FROM categories WHERE id=?').bind(categoryId).first<{ id: string; is_active: number; requires_verification: number }>() : null;
  if (categoryId && (!category || category.is_active !== 1)) return json([]);
  let sql = `SELECT w.id,w.user_id,u.display_name,w.bio,w.locality,w.years_experience,w.radius_km,w.hourly_rate_cents,w.pricing_type,
    w.verification_status,w.available_now,w.availability_updated_at,w.is_demo,COUNT(DISTINCT r.id) review_count,AVG(r.rating) average_rating
    FROM workers w JOIN users u ON u.id=w.user_id LEFT JOIN reviews r ON r.worker_id=w.id
    WHERE u.is_suspended=0 AND w.verification_status<>'Suspended'
      AND EXISTS (SELECT 1 FROM offerings o JOIN categories c ON c.id=o.category_id WHERE o.worker_id=w.id AND c.is_active=1
        AND (c.requires_verification=0 OR w.verification_status='Verified')`;
  const binds: unknown[] = [];
  if (categoryId) { sql += ' AND o.category_id=?'; binds.push(categoryId); }
  if (mode) { sql += ' AND EXISTS (SELECT 1 FROM offering_modes om WHERE om.offering_id=o.id AND om.mode=?)'; binds.push(mode); }
  sql += ')';
  if (category?.requires_verification) sql += " AND w.verification_status='Verified'";
  if (availableOnly) sql += ' AND w.available_now=1';
  if (maxPrice !== null) { sql += ' AND w.hourly_rate_cents<=?'; binds.push(Math.round(maxPrice * 100)); }
  sql += ' GROUP BY w.id ORDER BY u.display_name COLLATE NOCASE';
  const workers = await rows<WorkerBase>(c.env.DB.prepare(sql).bind(...binds));
  let origin: { latitude: number; longitude: number } | null = null;
  if (locality) {
    origin = await c.env.DB.prepare('SELECT latitude,longitude FROM localities WHERE name=? COLLATE NOCASE').bind(locality).first();
    if (!origin) return json([]);
  }
  let start: Date | null = null;
  let end: Date | null = null;
  if (availableOnly || startText) {
    start = resolveStartAt(startText ?? c.now.toISOString(), availableOnly, c.now);
    end = validEnd(start, duration, c.now);
  }
  const candidateWorkers: WorkerBase[] = [];
  const localityPoints = new Map<string, { latitude: number; longitude: number }>();
  if (origin && workers.length) {
    const names = [...new Set(workers.map(w => w.locality))];
    const points = await rows<{ name: string; latitude: number; longitude: number }>(c.env.DB.prepare(
      `SELECT name,latitude,longitude FROM localities WHERE name IN (${names.map(() => '?').join(',')}) COLLATE NOCASE`).bind(...names));
    for (const point of points) localityPoints.set(point.name.toLowerCase(), point);
  }
  for (const worker of workers) {
    if (origin) {
      const point = localityPoints.get(worker.locality.toLowerCase());
      if (!point || distanceKm(origin.latitude, origin.longitude, point.latitude, point.longitude) > worker.radius_km) continue;
    }
    candidateWorkers.push(worker);
  }
  let filtered = candidateWorkers;
  if (start && end && candidateWorkers.length) {
    const ids = candidateWorkers.map(w => w.id), placeholders = ids.map(() => '?').join(',');
    const [allHours, allExceptions, busy] = await Promise.all([
      rows<HourRow & { worker_id: string }>(c.env.DB.prepare(`SELECT worker_id,weekday,start_time,end_time FROM weekly_hours WHERE worker_id IN (${placeholders})`).bind(...ids)),
      rows<ExceptionRow & { worker_id: string }>(c.env.DB.prepare(`SELECT worker_id,date,is_available FROM availability_exceptions WHERE worker_id IN (${placeholders})`).bind(...ids)),
      rows<{ worker_id: string }>(c.env.DB.prepare(`SELECT DISTINCT worker_id FROM bookings WHERE worker_id IN (${placeholders})
        AND status IN (${STATUSES.map(() => '?').join(',')}) AND start_at<? AND ?<end_at`)
        .bind(...ids, ...STATUSES, end.toISOString(), start.toISOString())),
    ]);
    const busySet = new Set(busy.map(x => x.worker_id));
    const hourMap = new Map<string, HourRow[]>(), exceptionMap = new Map<string, ExceptionRow[]>();
    for (const row of allHours) { const list = hourMap.get(row.worker_id) ?? []; list.push(row); hourMap.set(row.worker_id, list); }
    for (const row of allExceptions) { const list = exceptionMap.get(row.worker_id) ?? []; list.push(row); exceptionMap.set(row.worker_id, list); }
    filtered = candidateWorkers.filter(w => !busySet.has(w.id)
      && isAvailableAt(hourMap.get(w.id) ?? [], exceptionMap.get(w.id) ?? [], start, end));
  }
  if (!filtered.length) return json([]);
  const ids = filtered.map(w => w.id), placeholders = ids.map(() => '?').join(',');
  const offerRows = await rows<OfferingListRow>(c.env.DB.prepare(`SELECT o.worker_id,o.category_id,o.pricing_type,o.price_cents,group_concat(om.mode,',') AS modes
    FROM offerings o LEFT JOIN offering_modes om ON om.offering_id=o.id WHERE o.worker_id IN (${placeholders}) GROUP BY o.id ORDER BY o.category_id`).bind(...ids));
  return json(filtered.map(w => summaryView(w, offerRows)));
}

async function me(c: Context): Promise<Response> {
  const actor = requireActor(c);
  return json({ id: actor.id, email: actor.email, displayName: actor.displayName, phone: actor.phone, locality: actor.locality, role: actor.role });
}

async function updateMe(c: Context): Promise<Response> {
  const actor = requireActor(c);
  await validateCsrf(c);
  const b = await readJson(c.request);
  const displayName = text(b.displayName, 'Name', 100, 2);
  const phone = text(b.phone, 'Phone', 40, 6);
  const locality = text(b.locality, 'Locality', 100, 1);
  const valid = await c.env.DB.prepare('SELECT 1 FROM localities WHERE name=? COLLATE NOCASE').bind(locality).first();
  if (!valid) throw new HttpError(400, 'Choose a supported Malta or Gozo locality');
  const worker = actor.role === 'Worker' ? await c.env.DB.prepare('SELECT id,version FROM workers WHERE user_id=?').bind(actor.id).first<{ id: string; version: number }>() : null;
  const stmts: D1PreparedStatement[] = [];
  const stamp = mutationStamp(c.now), now = c.now.toISOString();
  if (worker) stmts.push(c.env.DB.prepare('UPDATE workers SET locality=?,version=version+1,updated_at=? WHERE id=? AND version=?')
    .bind(locality, stamp, worker.id, worker.version));
  stmts.push(c.env.DB.prepare(`UPDATE users SET display_name=?,phone=?,locality=?,updated_at=? WHERE id=? ${worker ? 'AND EXISTS (SELECT 1 FROM workers WHERE id=? AND version=? AND updated_at=?)' : ''}`)
    .bind(displayName, phone, locality, now, actor.id, ...(worker ? [worker.id, worker.version + 1, stamp] : [])));
  const result = await c.env.DB.batch(stmts);
  if (worker && result[0].meta.changes !== 1) throw new HttpError(409, 'Your worker profile changed. Refresh and try again.');
  if (result[result.length - 1].meta.changes !== 1) throw new HttpError(409, 'Your account changed. Refresh and try again.');
  return json({ id: actor.id, email: actor.email, displayName, phone, locality, role: actor.role });
}

async function addresses(c: Context): Promise<Response> {
  const actor = requireActor(c, ['Customer']);
  const list = await rows<{ id: string; label: string; address: string; locality: string }>(c.env.DB.prepare('SELECT id,label,address,locality FROM customer_addresses WHERE user_id=? ORDER BY rowid').bind(actor.id));
  return json(list);
}
async function addAddress(c: Context): Promise<Response> {
  const actor = requireActor(c, ['Customer']);
  await validateCsrf(c);
  const b = await readJson(c.request);
  const label = text(b.label, 'Label', 80, 1), address = text(b.address, 'Address', 300, 1), locality = text(b.locality, 'Locality', 100, 1);
  if (!await c.env.DB.prepare('SELECT 1 FROM localities WHERE name=? COLLATE NOCASE').bind(locality).first()) throw new HttpError(400, 'Choose a supported Malta or Gozo locality');
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO customer_addresses (id,user_id,label,address,locality) VALUES (?,?,?,?,?)').bind(id, actor.id, label, address, locality).run();
  return json({ id, userId: actor.id, label, address, locality }, 201);
}
async function deleteAddress(c: Context, rawId: string): Promise<Response> {
  const actor = requireActor(c, ['Customer']);
  await validateCsrf(c);
  const id = uuid(rawId);
  const result = await c.env.DB.prepare('DELETE FROM customer_addresses WHERE id=? AND user_id=?').bind(id, actor.id).run();
  if (result.meta.changes !== 1) throw new HttpError(404, 'Address not found.');
  return new Response(null, { status: 204 });
}

async function workerProfile(c: Context): Promise<Response> {
  const actor = requireActor(c, ['Worker']);
  const row = await c.env.DB.prepare('SELECT id FROM workers WHERE user_id=?').bind(actor.id).first<{ id: string }>();
  if (!row) throw new HttpError(404, 'Worker profile not found.');
  const view = await getWorkerView(c.env, row.id, true, true);
  const status = await c.env.DB.prepare('SELECT verification_reference,verification_notes FROM workers WHERE id=?').bind(row.id).first<{ verification_reference: string | null; verification_notes: string | null }>();
  return json({ ...view, verificationReference: status?.verification_reference, verificationNotes: status?.verification_notes });
}

async function updateWorkerProfile(c: Context): Promise<Response> {
  const actor = requireActor(c, ['Worker']);
  await validateCsrf(c);
  const b = await readJson(c.request);
  const displayName = text(b.displayName, 'Name', 100, 2), bio = text(b.bio, 'Bio', 2000);
  const locality = text(b.locality, 'Locality', 100, 1);
  const years = numeric(b.yearsExperience, 'Years of experience', 0, 100);
  if (!Number.isInteger(years)) throw new HttpError(400, 'Years of experience must be a whole number.');
  const radius = numeric(b.radiusKm, 'Radius', 1, 200);
  const hourlyCents = euroToCents(b.hourlyRate, 'Hourly rate');
  const pricing = choice(b.pricingType, PRICING, 'pricing type');
  if (!Array.isArray(b.categoryIds) || b.categoryIds.length < 1 || b.categoryIds.length > 30) throw new HttpError(400, 'Choose between 1 and 30 categories.');
  const categoryIds = [...new Set(b.categoryIds.map(uuid))];
  if (categoryIds.length !== b.categoryIds.length) throw new HttpError(400, 'Categories must be unique.');
  if (!Array.isArray(b.modes) || b.modes.length < 1 || b.modes.length > 3) throw new HttpError(400, 'Choose at least one service mode.');
  const modes = [...new Set(b.modes.map(x => choice(x, MODES, 'mode')))];
  if (modes.length !== b.modes.length) throw new HttpError(400, 'Service modes must be unique.');
  if (!await c.env.DB.prepare('SELECT 1 FROM localities WHERE name=? COLLATE NOCASE').bind(locality).first()) throw new HttpError(400, 'Choose a supported Malta or Gozo locality');
  const categories = await rows<{ id: string; requires_verification: number }>(c.env.DB.prepare(`SELECT id,requires_verification FROM categories WHERE is_active=1 AND id IN (${categoryIds.map(() => '?').join(',')})`).bind(...categoryIds));
  if (categories.length !== categoryIds.length) throw new HttpError(400, 'Selected category is unavailable.');
  const supportedModes = await rows<{ category_id: string; mode: string }>(c.env.DB.prepare(`SELECT category_id,mode FROM category_modes WHERE category_id IN (${categoryIds.map(() => '?').join(',')})`).bind(...categoryIds));
  if (categoryIds.some(id => !modes.some(m => supportedModes.some(x => x.category_id === id && x.mode === m)))) throw new HttpError(400, 'Selected category or mode is unavailable.');
  if (categories.some(x => x.requires_verification === 1) && modes.some(x => x !== 'ForMe')) throw new HttpError(400, 'Regulated categories can only allow ForMe.');
  const worker = await c.env.DB.prepare('SELECT id,version FROM workers WHERE user_id=?').bind(actor.id).first<{ id: string; version: number }>();
  if (!worker) throw new HttpError(404, 'Worker profile not found.');
  const id = worker.id, nextVersion = worker.version + 1, now = c.now.toISOString(), stamp = mutationStamp(c.now);
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`UPDATE workers SET locality=?,bio=?,years_experience=?,radius_km=?,hourly_rate_cents=?,pricing_type=?,version=version+1,updated_at=? WHERE id=? AND version=?`)
      .bind(locality,bio,years,radius,hourlyCents,pricing,stamp,id,worker.version),
    c.env.DB.prepare('UPDATE users SET display_name=?,locality=?,updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM workers WHERE id=? AND version=? AND updated_at=?)')
      .bind(displayName,locality,now,actor.id,id,nextVersion,stamp),
    c.env.DB.prepare('DELETE FROM offerings WHERE worker_id=? AND EXISTS (SELECT 1 FROM workers WHERE id=? AND version=? AND updated_at=?)').bind(id,id,nextVersion,stamp),
  ];
  for (const categoryId of categoryIds) {
    const offeringId = crypto.randomUUID();
    statements.push(c.env.DB.prepare(`INSERT INTO offerings(id,worker_id,category_id,pricing_type,price_cents)
      SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workers WHERE id=? AND version=? AND updated_at=?)`).bind(offeringId,id,categoryId,pricing,hourlyCents,id,nextVersion,stamp));
    for (const mode of modes.filter(m => supportedModes.some(x => x.category_id === categoryId && x.mode === m))) {
      statements.push(c.env.DB.prepare(`INSERT INTO offering_modes(offering_id,mode) SELECT ?,? WHERE EXISTS
        (SELECT 1 FROM workers WHERE id=? AND version=? AND updated_at=?)`).bind(offeringId,mode,id,nextVersion,stamp));
    }
  }
  const result = await c.env.DB.batch(statements);
  if (result[0].meta.changes !== 1) throw new HttpError(409, 'Your worker profile changed. Refresh and try again.');
  return workerProfile(c);
}

async function updateAvailability(c: Context): Promise<Response> {
  const actor = requireActor(c, ['Worker']);
  await validateCsrf(c);
  const b = await readJson(c.request);
  if (typeof b.availableNow !== 'boolean' || !Array.isArray(b.windows) || !Array.isArray(b.exceptions) || b.windows.length > 70 || b.exceptions.length > 366)
    throw new HttpError(400, 'Invalid availability schedule.');
  const windows = b.windows.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Invalid availability schedule.');
    const x = raw as Record<string, unknown>;
    const weekday = numeric(x.dayOfWeek, 'Day of week', 0, 6);
    const start = text(x.startTime, 'Start time', 8, 4), end = text(x.endTime, 'End time', 8, 4);
    if (!Number.isInteger(weekday) || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(end) || start >= end)
      throw new HttpError(400, 'Invalid availability schedule.');
    return { weekday, start, end };
  });
  if (new Set(windows.map(x => `${x.weekday}:${x.start}:${x.end}`)).size !== windows.length) throw new HttpError(400, 'Availability windows must be unique.');
  const exceptions = b.exceptions.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Invalid availability schedule.');
    const x = raw as Record<string, unknown>;
    const date = text(x.date, 'Date', 10, 10);
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.valueOf()) || parsedDate.toISOString().slice(0,10) !== date || typeof x.isAvailable !== 'boolean') throw new HttpError(400, 'Invalid availability schedule.');
    return { date, available: x.isAvailable };
  });
  if (new Set(exceptions.map(x => x.date)).size !== exceptions.length) throw new HttpError(400, 'Availability exception dates must be unique.');
  const worker = await c.env.DB.prepare('SELECT id,version FROM workers WHERE user_id=?').bind(actor.id).first<{ id: string; version: number }>();
  if (!worker) throw new HttpError(404, 'Worker profile not found.');
  const id = worker.id, nextVersion = worker.version + 1, now = c.now.toISOString(), stamp = mutationStamp(c.now);
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare('UPDATE workers SET available_now=?,availability_updated_at=?,version=version+1,updated_at=? WHERE id=? AND version=?')
      .bind(b.availableNow ? 1 : 0,now,stamp,id,worker.version),
    c.env.DB.prepare('DELETE FROM weekly_hours WHERE worker_id=? AND EXISTS (SELECT 1 FROM workers WHERE id=? AND version=? AND updated_at=?)').bind(id,id,nextVersion,stamp),
    c.env.DB.prepare('DELETE FROM availability_exceptions WHERE worker_id=? AND EXISTS (SELECT 1 FROM workers WHERE id=? AND version=? AND updated_at=?)').bind(id,id,nextVersion,stamp),
  ];
  for (const w of windows) stmts.push(c.env.DB.prepare(`INSERT INTO weekly_hours(id,worker_id,weekday,start_time,end_time)
    SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workers WHERE id=? AND version=? AND updated_at=?)`).bind(crypto.randomUUID(),id,w.weekday,w.start,w.end,id,nextVersion,stamp));
  for (const e of exceptions) stmts.push(c.env.DB.prepare(`INSERT INTO availability_exceptions(worker_id,date,is_available)
    SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM workers WHERE id=? AND version=? AND updated_at=?)`).bind(id,e.date,e.available?1:0,id,nextVersion,stamp));
  const result = await c.env.DB.batch(stmts);
  if (result[0].meta.changes !== 1) throw new HttpError(409, 'Your availability changed. Refresh and try again.');
  return json({ availableNow: b.availableNow, availabilityUpdatedAt: now, windows: windows.map(w => ({ dayOfWeek:w.weekday,startTime:w.start,endTime:w.end })), exceptions: exceptions.map(e => ({ date:e.date,isAvailable:e.available })) });
}

async function submitVerification(c: Context): Promise<Response> {
  const actor = requireActor(c, ['Worker']);
  await validateCsrf(c);
  const b = await readJson(c.request);
  const reference = text(b.reference, 'Reference', 200, 1), notes = text(b.notes, 'Notes', 2000);
  const worker = await c.env.DB.prepare('SELECT id,version,verification_status FROM workers WHERE user_id=?').bind(actor.id).first<{ id: string; version: number; verification_status: string }>();
  if (!worker) throw new HttpError(404, 'Worker profile not found.');
  if (worker.verification_status === 'Suspended') throw new HttpError(403, 'Suspended workers cannot submit verification material.');
  const status = worker.verification_status === 'Verified' ? 'Verified' : 'Pending';
  const now = c.now.toISOString(), stamp = mutationStamp(c.now);
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE workers SET verification_reference=?,verification_notes=?,verification_status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND verification_status<>'Suspended'`)
      .bind(reference,notes,status,stamp,worker.id,worker.version),
    c.env.DB.prepare(`INSERT INTO audit_entries(id,action,actor_id,created_at,details_json) SELECT ?,?,?,?,? WHERE EXISTS
      (SELECT 1 FROM workers WHERE id=? AND version=? AND updated_at=?)`).bind(crypto.randomUUID(),'worker.verification.submitted',actor.id,now,JSON.stringify({ workerId:worker.id }),worker.id,worker.version+1,stamp),
  ]);
  if (result[0].meta.changes !== 1) throw new HttpError(409, 'Your verification status changed. Refresh and try again.');
  return json({ verificationStatus: status });
}
