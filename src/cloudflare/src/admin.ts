import { hashPassword, requireActor, validateCsrf } from './auth';
import { changed, choice, HttpError, json, numeric, readJson, rows, text, uuid } from './http';
import type { Context } from './types';

const VERIFICATION = ['Verified', 'Rejected', 'Suspended'] as const;
const MODES = ['ForMe', 'WithMe', 'TeachMe'] as const;
const PRICING = ['Hourly', 'Fixed', 'Quote'] as const;
function stamp(c: Context): string { return c.now.toISOString(); }
function audit(c: Context, action: string, details: unknown): D1PreparedStatement {
  return c.env.DB.prepare('INSERT INTO audit_entries(id,action,actor_id,created_at,details_json) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), action, c.actor!.id, stamp(c), JSON.stringify(details));
}
function modesValue(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new HttpError(400, 'Choose at least one service mode.');
  const modes = value.map(x => choice(x, MODES, 'service mode'));
  if (new Set(modes).size !== modes.length) throw new HttpError(400, 'Service modes must be unique.');
  return modes;
}
function categoryFields(body: Record<string, unknown>) {
  const slug = text(body.slug, 'Slug', 100, 2).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new HttpError(400, 'Slug may contain lowercase letters, numbers and hyphens.');
  const name = text(body.name, 'Name', 120, 2);
  const description = text(body.description, 'Description', 2000);
  const icon = text(body.icon, 'Icon', 80, 1);
  if (typeof body.requiresVerification !== 'boolean' || typeof body.isActive !== 'boolean') throw new HttpError(400, 'Verification and active values must be true or false.');
  const modes = modesValue(body.modes);
  if (body.requiresVerification && modes.some(mode => mode !== 'ForMe')) throw new HttpError(400, 'Regulated categories can only allow ForMe.');
  return { slug, name, description, icon, requiresVerification: body.requiresVerification, isActive: body.isActive, modes };
}

export async function handleAdmin(c: Context): Promise<Response | undefined> {
  const path = c.url.pathname, method = c.request.method;
  if (!path.startsWith('/api/admin/')) return undefined;
  if (path === '/api/admin/staging-demo/fixture' && method === 'POST') {
    // A disabled or mismatched fixture endpoint stays indistinguishable from
    // an absent route, including for unauthenticated requests.
    if (c.env.ENVIRONMENT !== 'staging' || c.env.STAGING_DEMO_ENABLED !== 'true'
      || !c.env.STAGING_DEMO_DATABASE_NAME?.trim().endsWith('_staging_demo')) throw new HttpError(404, 'Not found.');
    const marker = await rows<{ key: string; value: string }>(c.env.DB.prepare("SELECT key,value FROM deployment_info WHERE key IN ('database_name','environment')"));
    const markers = new Map(marker.map(x => [x.key,x.value]));
    if (markers.get('database_name') !== c.env.STAGING_DEMO_DATABASE_NAME.trim() || markers.get('environment') !== 'staging')
      throw new HttpError(404, 'Not found.');
    requireActor(c, ['Admin']);
    return stagingFixture(c);
  }
  requireActor(c, ['Admin']);
  if (path === '/api/admin/overview' && method === 'GET') return overview(c);
  if (path === '/api/admin/workers' && method === 'GET') return workers(c);
  if (path === '/api/admin/users' && method === 'GET') return users(c);
  if (path === '/api/admin/payments' && method === 'GET') return payments(c);
  if (path === '/api/admin/audit' && method === 'GET') return auditList(c);
  if (path === '/api/admin/privacy-requests' && method === 'GET') return privacyRequests(c);
  if (path === '/api/admin/categories' && method === 'GET') return categories(c);
  if (path === '/api/admin/categories' && method === 'POST') return createCategory(c);
  if (path === '/api/admin/settings' && method === 'PUT') return updateSettings(c);
  const verification = path.match(/^\/api\/admin\/workers\/([^/]+)\/verification$/);
  if (verification && method === 'POST') return setVerification(c, uuid(verification[1]));
  const userStatus = path.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
  if (userStatus && method === 'POST') return setUserStatus(c, uuid(userStatus[1]));
  const category = path.match(/^\/api\/admin\/categories\/([^/]+)$/);
  if (category && method === 'PUT') return updateCategory(c, uuid(category[1]));
  if (category && method === 'DELETE') return deleteCategory(c, uuid(category[1]));
  return undefined;
}

async function overview(c: Context): Promise<Response> {
  const counts = await c.env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM users WHERE role='Customer') customers,
    (SELECT COUNT(*) FROM workers) workers,
    (SELECT COUNT(*) FROM workers WHERE verification_status='Pending') pending_verifications,
    (SELECT COUNT(*) FROM bookings WHERE status IN ('Requested','Quoted')) open_requests,
    (SELECT COUNT(*) FROM bookings WHERE status='Confirmed') confirmed_bookings,
    (SELECT COUNT(*) FROM bookings WHERE status='Completed') completed_bookings,
    (SELECT COUNT(*) FROM bookings WHERE status='Cancelled') cancelled_bookings,
    (SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE is_simulated=1) simulated_gross_cents,
    (SELECT COALESCE(SUM(commission_cents),0) FROM payments WHERE is_simulated=1) simulated_commission_cents`).first<{
      customers: number; workers: number; pending_verifications: number; open_requests: number; confirmed_bookings: number;
      completed_bookings: number; cancelled_bookings: number; simulated_gross_cents: number; simulated_commission_cents: number;
    }>();
  const setting = await c.env.DB.prepare('SELECT commission_bps FROM settings WHERE id=1').first<{ commission_bps: number }>();
  return json({ customers: counts?.customers ?? 0, workers: counts?.workers ?? 0,
    pendingVerifications: counts?.pending_verifications ?? 0, openRequests: counts?.open_requests ?? 0,
    confirmedBookings: counts?.confirmed_bookings ?? 0, completedBookings: counts?.completed_bookings ?? 0,
    cancelledBookings: counts?.cancelled_bookings ?? 0, simulatedGross: (counts?.simulated_gross_cents ?? 0) / 100,
    simulatedCommission: (counts?.simulated_commission_cents ?? 0) / 100,
    commissionPercent: (setting?.commission_bps ?? 1200) / 100 });
}

async function workers(c: Context): Promise<Response> {
  const list = await rows<{
    id: string; user_id: string; display_name: string; bio: string; locality: string; years_experience: number;
    radius_km: number; hourly_rate_cents: number; pricing_type: string; verification_status: string;
    verification_reference: string | null; verification_notes: string | null; available_now: number;
    availability_updated_at: string; is_demo: number; review_count: number; average_rating: number | null;
  }>(c.env.DB.prepare(`SELECT w.id,w.user_id,u.display_name,w.bio,w.locality,w.years_experience,w.radius_km,w.hourly_rate_cents,
    w.pricing_type,w.verification_status,w.verification_reference,w.verification_notes,w.available_now,w.availability_updated_at,
    w.is_demo,COUNT(r.id) review_count,AVG(r.rating) average_rating FROM workers w JOIN users u ON u.id=w.user_id
    LEFT JOIN reviews r ON r.worker_id=w.id GROUP BY w.id ORDER BY u.display_name COLLATE NOCASE`));
  const offered = await rows<{ worker_id: string; category_id: string; mode: string }>(c.env.DB.prepare(`SELECT o.worker_id,o.category_id,om.mode
    FROM offerings o LEFT JOIN offering_modes om ON om.offering_id=o.id ORDER BY o.worker_id,o.category_id,om.mode`));
  return json(list.map(w => {
    const serviceRows = offered.filter(x => x.worker_id === w.id);
    return { id: w.id, userId: w.user_id, displayName: w.display_name, bio: w.bio, locality: w.locality,
      yearsExperience: w.years_experience, radiusKm: w.radius_km, hourlyRate: w.hourly_rate_cents / 100,
      pricingType: w.pricing_type, verificationStatus: w.verification_status, verificationReference: w.verification_reference,
      verificationNotes: w.verification_notes, availableNow: w.available_now === 1, availabilityUpdatedAt: w.availability_updated_at,
      isDemo: w.is_demo === 1, categoryIds: [...new Set(serviceRows.map(x => x.category_id))],
      modes: [...new Set(serviceRows.flatMap(x => x.mode ? [x.mode] : []))], reviewCount: w.review_count,
      averageRating: w.average_rating };
  }));
}

async function users(c: Context): Promise<Response> {
  const list = await rows<{ id: string; email: string; display_name: string; role: string; is_suspended: number }>(
    c.env.DB.prepare('SELECT id,email,display_name,role,is_suspended FROM users ORDER BY created_at DESC'));
  return json(list.map(u => ({ id: u.id, email: u.email, displayName: u.display_name, role: u.role, isSuspended: u.is_suspended === 1 })));
}

async function setVerification(c: Context, workerId: string): Promise<Response> {
  await validateCsrf(c);
  const body = await readJson(c.request);
  const status = choice(body.status, VERIFICATION, 'verification status');
  const worker = await c.env.DB.prepare('SELECT id,version FROM workers WHERE id=?').bind(workerId).first<{ id: string; version: number }>();
  if (!worker) throw new HttpError(404, 'Worker not found.');
  const now = stamp(c), next = worker.version + 1;
  const result = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE workers SET verification_status=?,version=version+1,updated_at=? WHERE id=? AND version=?')
      .bind(status, now, workerId, worker.version),
    c.env.DB.prepare(`INSERT INTO audit_entries(id,action,actor_id,created_at,details_json) SELECT ?,?,?,?,?
      WHERE changes()=1 AND EXISTS (SELECT 1 FROM workers WHERE id=? AND version=? AND updated_at=?)`)
      .bind(crypto.randomUUID(), 'worker.verification.changed', c.actor!.id, now, JSON.stringify({ workerId, status }), workerId, next, now),
  ]);
  changed(result[0]);
  return json({ workerId, verificationStatus: status });
}

async function setUserStatus(c: Context, userId: string): Promise<Response> {
  await validateCsrf(c);
  const body = await readJson(c.request);
  if (typeof body.isSuspended !== 'boolean') throw new HttpError(400, 'isSuspended must be true or false.');
  if (userId === c.actor!.id && body.isSuspended) throw new HttpError(400, 'You cannot suspend your own account.');
  const now = stamp(c);
  const result = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET is_suspended=?,updated_at=? WHERE id=?').bind(body.isSuspended ? 1 : 0, now, userId),
    c.env.DB.prepare(`INSERT INTO audit_entries(id,action,actor_id,created_at,details_json) SELECT ?,?,?,?,?
      WHERE changes()=1 AND EXISTS (SELECT 1 FROM users WHERE id=? AND is_suspended=? AND updated_at=?)`)
      .bind(crypto.randomUUID(), 'user.status.changed', c.actor!.id, now, JSON.stringify({ userId, isSuspended: body.isSuspended }), userId, body.isSuspended ? 1 : 0, now),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND ?=1 AND EXISTS (SELECT 1 FROM users WHERE id=? AND is_suspended=1 AND updated_at=?)`)
      .bind(userId, body.isSuspended ? 1 : 0, userId, now),
  ]);
  if (result[0].meta.changes !== 1) throw new HttpError(404, 'User not found.');
  return json({ id: userId, isSuspended: body.isSuspended });
}

async function categories(c: Context): Promise<Response> {
  const list = await rows<{ id: string; slug: string; name: string; description: string; icon: string; requires_verification: number; is_active: number }>(
    c.env.DB.prepare('SELECT id,slug,name,description,icon,requires_verification,is_active FROM categories ORDER BY name COLLATE NOCASE'));
  const modes = await rows<{ category_id: string; mode: string }>(c.env.DB.prepare('SELECT category_id,mode FROM category_modes'));
  return json(list.map(x => ({ id: x.id, slug: x.slug, name: x.name, description: x.description, icon: x.icon,
    modes: modes.filter(m => m.category_id === x.id).map(m => m.mode), requiresVerification: x.requires_verification === 1,
    isActive: x.is_active === 1 })));
}

async function createCategory(c: Context): Promise<Response> {
  await validateCsrf(c);
  const input = categoryFields(await readJson(c.request));
  const id = crypto.randomUUID(), now = stamp(c);
  const statements = [c.env.DB.prepare(`INSERT INTO categories(id,slug,name,description,icon,requires_verification,is_active) VALUES (?,?,?,?,?,?,?)`)
    .bind(id,input.slug,input.name,input.description,input.icon,input.requiresVerification ? 1 : 0,input.isActive ? 1 : 0)];
  for (const mode of input.modes) statements.push(c.env.DB.prepare('INSERT INTO category_modes(category_id,mode) VALUES (?,?)').bind(id,mode));
  statements.push(c.env.DB.prepare(`INSERT INTO audit_entries(id,action,actor_id,created_at,details_json) VALUES (?,?,?,?,?)`)
    .bind(crypto.randomUUID(), 'category.created', c.actor!.id, now, JSON.stringify({ categoryId:id, slug:input.slug })));
  try { await c.env.DB.batch(statements); }
  catch (error) { if (String(error).toLowerCase().includes('unique')) throw new HttpError(409, 'A category with that slug already exists.'); throw error; }
  return json({ id, ...input }, 201);
}

async function updateCategory(c: Context, id: string): Promise<Response> {
  await validateCsrf(c);
  const input = categoryFields(await readJson(c.request));
  const now = stamp(c);
  const statements: D1PreparedStatement[] = [c.env.DB.prepare(`UPDATE categories SET slug=?,name=?,description=?,icon=?,requires_verification=?,is_active=? WHERE id=?`)
    .bind(input.slug,input.name,input.description,input.icon,input.requiresVerification ? 1 : 0,input.isActive ? 1 : 0,id)];
  statements.push(c.env.DB.prepare('DELETE FROM category_modes WHERE category_id=? AND EXISTS (SELECT 1 FROM categories WHERE id=?)').bind(id,id));
  for (const mode of input.modes) statements.push(c.env.DB.prepare('INSERT INTO category_modes(category_id,mode) SELECT ?,? WHERE EXISTS (SELECT 1 FROM categories WHERE id=?)').bind(id,mode,id));
  statements.push(c.env.DB.prepare(`INSERT INTO audit_entries(id,action,actor_id,created_at,details_json) SELECT ?,?,?,?,? WHERE changes()=1 AND EXISTS (SELECT 1 FROM categories WHERE id=?)`)
    .bind(crypto.randomUUID(),'category.updated',c.actor!.id,now,JSON.stringify({ categoryId:id, slug:input.slug }),id));
  try {
    const result = await c.env.DB.batch(statements);
    if (result[0].meta.changes !== 1) throw new HttpError(404, 'Category not found.');
  } catch (error) { if (String(error).toLowerCase().includes('unique')) throw new HttpError(409, 'A category with that slug already exists.'); throw error; }
  return json({ id, ...input });
}

async function deleteCategory(c: Context, id: string): Promise<Response> {
  await validateCsrf(c);
  const existing = await c.env.DB.prepare('SELECT slug FROM categories WHERE id=?').bind(id).first<{ slug: string }>();
  if (!existing) throw new HttpError(404, 'Category not found.');
  const used = await c.env.DB.prepare('SELECT 1 AS found FROM offerings WHERE category_id=? UNION ALL SELECT 1 FROM bookings WHERE category_id=? LIMIT 1')
    .bind(id,id).first<{ found: number }>();
  if (used) throw new HttpError(409, 'A category with offerings or bookings cannot be deleted.');
  const result = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM categories WHERE id=?').bind(id),
    c.env.DB.prepare(`INSERT INTO audit_entries(id,action,actor_id,created_at,details_json) SELECT ?,?,?,?,? WHERE changes()=1`)
      .bind(crypto.randomUUID(),'category.deleted',c.actor!.id,stamp(c),JSON.stringify({ categoryId:id, slug:existing.slug })),
  ]);
  if (result[0].meta.changes !== 1) throw new HttpError(409, 'Category changed. Refresh and try again.');
  return new Response(null,{ status:204,headers:{'Cache-Control':'no-store'} });
}

async function updateSettings(c: Context): Promise<Response> {
  await validateCsrf(c);
  const body = await readJson(c.request);
  const percent = numeric(body.commissionPercent,'Commission percentage',0,100);
  if (Math.abs(percent * 100 - Math.round(percent * 100)) > 0.000001) throw new HttpError(400,'Commission supports at most two decimal places.');
  const bps = Math.round(percent * 100);
  const result = await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO settings(id,commission_bps) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET commission_bps=excluded.commission_bps').bind(bps),
    c.env.DB.prepare(`INSERT INTO audit_entries(id,action,actor_id,created_at,details_json) SELECT ?,?,?,?,? WHERE changes()=1`)
      .bind(crypto.randomUUID(),'settings.commission.changed',c.actor!.id,stamp(c),JSON.stringify({ commissionPercent:percent })),
  ]);
  if (result[0].meta.changes !== 1) throw new HttpError(409,'Settings changed. Refresh and try again.');
  return json({ commissionPercent: percent });
}

async function payments(c: Context): Promise<Response> {
  const list = await rows<{ id: string; booking_id: string; amount_cents: number; commission_cents: number; status: string; is_simulated: number; created_at: string }>(
    c.env.DB.prepare('SELECT id,booking_id,amount_cents,commission_cents,status,is_simulated,created_at FROM payments ORDER BY created_at DESC'));
  return json(list.map(p => ({ id:p.id,bookingId:p.booking_id,amount:p.amount_cents/100,commissionAmount:p.commission_cents/100,
    status:p.status,isSimulated:p.is_simulated===1,createdAt:p.created_at })));
}

async function auditList(c: Context): Promise<Response> {
  const list = await rows<{ id: string; action: string; actor_id: string | null; created_at: string; details_json: string }>(
    c.env.DB.prepare('SELECT id,action,actor_id,created_at,details_json FROM audit_entries ORDER BY created_at DESC'));
  return json(list.map(x => { let details: unknown = {}; try { details = JSON.parse(x.details_json); } catch { /* preserve a safe empty object */ }
    return { id:x.id,action:x.action,actorId:x.actor_id,createdAt:x.created_at,details }; }));
}

async function privacyRequests(c: Context): Promise<Response> {
  const list = await rows<{ id: string; user_id: string; kind: string; status: string; created_at: string }>(
    c.env.DB.prepare('SELECT id,user_id,kind,status,created_at FROM privacy_requests ORDER BY created_at DESC'));
  return json(list.map(x => ({ id:x.id,userId:x.user_id,kind:x.kind,status:x.status,createdAt:x.created_at })));
}

function randomPassword(): string {
  const entropy = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2,'0')).join('');
  return `StageA${entropy}9!`;
}

async function stagingFixture(c: Context): Promise<Response> {
  await validateCsrf(c);
  const configured = c.env.STAGING_DEMO_DATABASE_NAME?.trim() ?? '';
  if (c.env.ENVIRONMENT !== 'staging' || c.env.STAGING_DEMO_ENABLED !== 'true' || !configured.endsWith('_staging_demo'))
    throw new HttpError(404, 'Not found.');
  const marker = await rows<{ key: string; value: string }>(c.env.DB.prepare(`SELECT key,value FROM deployment_info WHERE key IN ('database_name','environment')`));
  const markers = new Map(marker.map(x => [x.key,x.value]));
  if (markers.get('database_name') !== configured || markers.get('environment') !== 'staging') throw new HttpError(404, 'Not found.');
  const real = await c.env.DB.prepare('SELECT 1 AS found FROM workers WHERE is_demo=0 LIMIT 1').first<{ found: number }>();
  if (real) throw new HttpError(409, 'Staging demo fixtures require a database with no real worker profiles.');
  const category = await c.env.DB.prepare("SELECT id FROM categories WHERE slug='cleaning' AND is_active=1 AND requires_verification=0").first<{ id: string }>();
  if (!category) throw new HttpError(503, 'The staging fixture category is unavailable.');
  const runId = crypto.randomUUID(), customerId = crypto.randomUUID(), workerUserId = crypto.randomUUID(), workerId = crypto.randomUUID();
  const customerEmail = `${runId}.customer@example.invalid`, workerEmail = `${runId}.worker@example.invalid`;
  const customerPassword = randomPassword(), workerPassword = randomPassword();
  const [customerHash,workerHash] = await Promise.all([hashPassword(customerPassword),hashPassword(workerPassword)]);
  const customerStamp = crypto.randomUUID(), workerStamp = crypto.randomUUID(), offeringId = crypto.randomUUID(), now = stamp(c);
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`INSERT INTO users(id,email,password_hash,security_stamp,display_name,phone,locality,role,created_at,updated_at) VALUES (?,?,?,?,?,'+356 0000 0000','Valletta','Customer',?,?)`)
      .bind(customerId,customerEmail,customerHash,customerStamp,'Staging Demo Customer',now,now),
    c.env.DB.prepare(`INSERT INTO users(id,email,password_hash,security_stamp,display_name,phone,locality,role,created_at,updated_at) VALUES (?,?,?,?,?,'+356 0000 0000','Valletta','Worker',?,?)`)
      .bind(workerUserId,workerEmail,workerHash,workerStamp,'Staging Demo Worker',now,now),
    c.env.DB.prepare(`INSERT INTO workers(id,user_id,bio,locality,years_experience,radius_km,hourly_rate_cents,pricing_type,verification_status,available_now,availability_updated_at,is_demo,version,created_at,updated_at)
      VALUES (?,?,'Fictional staging fixture worker.','Valletta',0,10,2000,'Hourly','Unverified',0,?,1,0,?,?)`)
      .bind(workerId,workerUserId,now,now,now),
    c.env.DB.prepare("INSERT INTO offerings(id,worker_id,category_id,pricing_type,price_cents) VALUES (?,?,?,'Hourly',2000)").bind(offeringId,workerId,category.id),
    c.env.DB.prepare("INSERT INTO offering_modes(offering_id,mode) VALUES (?,'ForMe')").bind(offeringId),
  ];
  for (let weekday=0;weekday<7;weekday++) statements.push(c.env.DB.prepare('INSERT INTO weekly_hours(id,worker_id,weekday,start_time,end_time) VALUES (?,?,?,\'00:00\',\'23:59\')')
    .bind(crypto.randomUUID(),workerId,weekday));
  statements.push(audit(c,'staging-demo.fixture.created',{ runId,workerId,categoryId:category.id }));
  await c.env.DB.batch(statements);
  return json({ runId,workerId,categoryId:category.id,
    customer:{ email:customerEmail,password:customerPassword },worker:{ email:workerEmail,password:workerPassword } },201);
}
