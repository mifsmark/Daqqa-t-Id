import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { Context, Env } from './types';
import { rateLimit, requireActor } from './auth';
import { HttpError, json, readJson } from './http';

type Claimed = { id: string; lease_token: string; subscription_id: string; session_id_hash: string; expires_at: string; endpoint: string; p256dh: string; auth: string; notification_id: string; title: string; message: string; url: string; tag: string; user_id: string; is_suspended: number; attempts: number };
const b64url = (bytes: Uint8Array) => {
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
function decode(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try { const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)); return Uint8Array.from(raw, c => c.charCodeAt(0)); } catch { return null; }
}
async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEndpoint(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com')
      || host === 'web.push.apple.com' || host.endsWith('.notify.windows.com');
    return allowed ? url.toString() : null;
  } catch { return null; }
}
function validConfig(env: Env): boolean {
  const pub = decode(env.VAPID_SERVER_PUBLIC_KEY), priv = decode(env.VAPID_SERVER_PRIVATE_KEY);
  let validSubject = false;
  try {
    const url = new URL(env.VAPID_SUBJECT ?? '');
    validSubject = url.protocol === 'mailto:' ? !!url.pathname && !url.search && !url.hash
      : url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.port && !url.hash;
  } catch { validSubject = false; }
  return validSubject && !!pub && pub.length === 65 && pub[0] === 4 && !!priv && priv.length === 32;
}
function noContent() { return new Response(null, { status: 204 }); }

export async function handleNotifications(c: Context, schedule?: (promise: Promise<unknown>) => void): Promise<Response | undefined> {
  if (!c.url.pathname.startsWith('/api/notifications')) return;
  const actor = requireActor(c);
  const path = c.url.pathname, method = c.request.method;
  if (path === '/api/notifications' && method === 'GET') {
    const result = await c.env.DB.prepare(`SELECT id,booking_id,kind,title,message,url,created_at,read_at FROM notifications
      WHERE recipient_id=? ORDER BY created_at DESC,id DESC LIMIT 40`).bind(actor.id).all<any>();
    const unread = await c.env.DB.prepare('SELECT count(*) count FROM notifications WHERE recipient_id=? AND read_at IS NULL').bind(actor.id).first<{ count: number }>();
    return json({ items: result.results.map((n: any) => ({ id:n.id,bookingId:n.booking_id,kind:n.kind,title:n.title,message:n.message,url:n.url,createdAt:n.created_at,readAt:n.read_at })), unreadCount: unread?.count ?? 0 });
  }
  if (path === '/api/notifications/read-all' && method === 'POST') {
    await c.env.DB.prepare('UPDATE notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL').bind(c.now.toISOString(), actor.id).run(); return noContent();
  }
  const readMatch = path.match(/^\/api\/notifications\/([0-9a-f-]{36})\/read$/i);
  if (readMatch && method === 'POST') {
    const updated = await c.env.DB.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient_id=?').bind(c.now.toISOString(), readMatch[1], actor.id).run();
    if (!updated.meta.changes) throw new HttpError(404, 'Notification not found.'); return noContent();
  }
  if (path === '/api/notifications/push-config' && method === 'GET') {
    let subscribed = false;
    if (c.session) subscribed = !!await c.env.DB.prepare('SELECT 1 FROM push_subscriptions WHERE session_id_hash=? AND user_id=?').bind(c.session.idHash, actor.id).first();
    return json({ enabled: validConfig(c.env), publicKey: validConfig(c.env) ? c.env.VAPID_SERVER_PUBLIC_KEY : null, subscribed });
  }
  if (path === '/api/notifications/push-subscriptions' && method === 'POST') {
    if (!validConfig(c.env)) throw new HttpError(503, 'Push notifications are not configured.');
    if (!c.session?.idHash) throw new HttpError(401, 'Authentication is required.');
    const input = await readJson(c.request), keys = input.keys as Record<string, unknown> | undefined;
    const endpoint = safeEndpoint(input.endpoint), p = decode(keys?.p256dh), a = decode(keys?.auth);
    if (!endpoint || !p || p.length !== 65 || p[0] !== 4 || !a || a.length !== 16) throw new HttpError(400, 'Invalid push subscription.');
    try { await crypto.subtle.importKey('raw', p, { name: 'ECDH', namedCurve: 'P-256' }, false, []); }
    catch { throw new HttpError(400, 'Invalid push subscription.'); }
    const endpointHash = await digest(endpoint);
    const saved = await c.env.DB.prepare(`INSERT INTO push_subscriptions(id,session_id_hash,user_id,endpoint,endpoint_hash,p256dh,auth,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sessions WHERE id_hash=? AND user_id=? AND expires_at>?)
        AND EXISTS (SELECT 1 FROM users WHERE id=? AND is_suspended=0)
        AND (EXISTS (SELECT 1 FROM push_subscriptions WHERE endpoint_hash=? AND user_id=?)
          OR (SELECT count(*) FROM push_subscriptions WHERE user_id=?)<5)
      ON CONFLICT(endpoint_hash) DO UPDATE SET session_id_hash=excluded.session_id_hash,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at
      WHERE push_subscriptions.user_id=excluded.user_id RETURNING id`).bind(crypto.randomUUID(),c.session.idHash,actor.id,endpoint,endpointHash,b64url(p),b64url(a),c.now.toISOString(),c.now.toISOString(),
        c.session.idHash,actor.id,c.now.toISOString(),actor.id,endpointHash,actor.id,actor.id).first();
    if (!saved) throw new HttpError(409,'This device subscription could not be registered. Check the device limit and current account session.');
    return noContent();
  }
  if (path === '/api/notifications/push-subscriptions' && method === 'DELETE') {
    if (c.session) await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE session_id_hash=? AND user_id=?').bind(c.session.idHash, actor.id).run(); return noContent();
  }
  if (path === '/api/notifications/test' && method === 'POST') {
    if (!validConfig(c.env)) throw new HttpError(503, 'Push notifications are not configured.');
    if (!c.session) throw new HttpError(401, 'Authentication is required.');
    await rateLimit(c, `notification-test:${actor.id}`, 3, 600);
    const subscription = await c.env.DB.prepare('SELECT id FROM push_subscriptions WHERE session_id_hash=? AND user_id=?').bind(c.session.idHash, actor.id).first();
    if (!subscription) throw new HttpError(409, 'Enable notifications on this device first.');
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO notifications(id,recipient_id,booking_id,source_event_id,kind,title,message,url,created_at)
      VALUES(?,?,NULL,?,'Test','Daqqa t’Id test notification','Notifications are enabled on this device.','/dashboard',?)`).bind(id, actor.id, `test:${id}`, c.now.toISOString()).run();
    if (schedule) schedule(drainPushNotifications(c.env)); return json({ queued: true }, 202);
  }
  return;
}

async function claim(env: Env, now: string): Promise<Claimed | null> {
  const cutoff = new Date(Date.parse(now)-24*60*60_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE push_deliveries SET status='Dead',lease_token=NULL,lease_until=NULL
      WHERE id IN (SELECT d.id FROM push_deliveries d JOIN notifications n ON n.id=d.notification_id
        WHERE d.status IN ('Pending','Leased') AND n.created_at<=? LIMIT 100)`).bind(cutoff),
    env.DB.prepare(`UPDATE push_deliveries SET status='Dead',lease_token=NULL,lease_until=NULL
      WHERE id IN (SELECT id FROM push_deliveries WHERE status='Leased' AND attempts>=6 AND lease_until<=? LIMIT 100)`).bind(now),
    env.DB.prepare(`DELETE FROM push_subscriptions WHERE id IN (SELECT s.id FROM push_subscriptions s JOIN sessions se ON se.id_hash=s.session_id_hash
      WHERE se.expires_at<=? LIMIT 100)`).bind(now),
  ]);
  const token = crypto.randomUUID();
  return env.DB.prepare(`UPDATE push_deliveries SET status='Leased',lease_token=?,lease_until=?,attempts=attempts+1
    WHERE id=(SELECT d.id FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id
      JOIN users u ON u.id=s.user_id JOIN sessions se ON se.id_hash=s.session_id_hash JOIN notifications n ON n.id=d.notification_id
      WHERE u.is_suspended=0 AND se.expires_at>? AND n.created_at>? AND (d.status='Pending' AND d.due_at<=? OR d.status='Leased' AND d.lease_until<=?)
      AND d.attempts<6 ORDER BY d.due_at,d.id LIMIT 1)
    RETURNING id,lease_token,subscription_id,notification_id`).bind(token, new Date(Date.parse(now)+60_000).toISOString(), now, cutoff, now, now).first<any>()
    .then(async row => {
      if (!row) return null;
      const item = await env.DB.prepare(`SELECT d.id,d.lease_token,d.attempts,s.id subscription_id,s.session_id_hash,s.endpoint,s.p256dh,s.auth,n.id notification_id,n.title,n.message,n.url,
        CASE WHEN n.booking_id IS NULL THEN n.id ELSE n.booking_id END tag,s.user_id,u.is_suspended,se.expires_at
        FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id JOIN notifications n ON n.id=d.notification_id JOIN users u ON u.id=s.user_id JOIN sessions se ON se.id_hash=s.session_id_hash
        WHERE d.id=? AND d.lease_token=?`).bind(row.id, token).first<Claimed>();
      return item ?? null;
    });
}
async function finish(env: Env, item: Claimed, now: string, status: 'Sent'|'Pending'|'Dead', httpStatus: number | null, delaySeconds = 0): Promise<void> {
  await env.DB.prepare(`UPDATE push_deliveries SET status=?,last_status=?,due_at=?,lease_token=NULL,lease_until=NULL
    WHERE id=? AND status='Leased' AND lease_token=?`).bind(status,httpStatus,new Date(Date.parse(now)+delaySeconds*1000).toISOString(),item.id,item.lease_token).run();
}
export async function drainPushNotifications(env: Env, now = new Date()): Promise<void> {
  if (!validConfig(env)) return;
  for (let i=0;i<2;i++) {
    const stamp = now.toISOString(), item = await claim(env, stamp); if (!item) return;
    const cutoff = new Date(now.getTime()-24*60*60_000).toISOString();
    const live = await env.DB.prepare(`SELECT 1 FROM push_subscriptions s JOIN sessions se ON se.id_hash=s.session_id_hash JOIN users u ON u.id=s.user_id
      JOIN notifications n ON n.recipient_id=s.user_id LEFT JOIN bookings b ON b.id=n.booking_id
      WHERE s.id=? AND s.session_id_hash=? AND se.expires_at>? AND u.is_suspended=0 AND n.id=? AND n.created_at>?
      AND (n.kind IN ('Review','Test') OR (b.id IS NOT NULL AND b.status=n.kind AND (n.kind<>'Requested' OR b.start_at>?)))`)
      .bind(item.subscription_id,item.session_id_hash,stamp,item.notification_id,cutoff,stamp).first();
    if (!live || item.is_suspended || Date.parse(item.expires_at)<=now.getTime() || safeEndpoint(item.endpoint)!==item.endpoint) {
      if (Date.parse(item.expires_at)<=now.getTime()) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(item.subscription_id).run();
      else await finish(env,item,stamp,'Dead',null);
      continue;
    }
    try {
      const init = await buildPushPayload({ data: JSON.stringify({title:item.title,body:item.message,url:item.url,tag:item.tag}),options:{ttl:3600} },
        { endpoint:item.endpoint,expirationTime:null,keys:{p256dh:item.p256dh,auth:item.auth} },
        { subject:env.VAPID_SUBJECT!,publicKey:env.VAPID_SERVER_PUBLIC_KEY!,privateKey:env.VAPID_SERVER_PRIVATE_KEY! });
      const response = await fetch(item.endpoint, { ...init, redirect:'manual', signal:AbortSignal.timeout(10_000) });
      if (response.ok) await finish(env,item,stamp,'Sent',response.status);
      else if (response.status===404 || response.status===410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(item.subscription_id).run();
      } else if ((response.status===429 || response.status>=500) && item.attempts<6) await finish(env,item,stamp,'Pending',response.status,Math.min(3600,30*2**(item.attempts-1)));
      else await finish(env,item,stamp,'Dead',response.status);
    } catch {
      if (item.attempts<6) await finish(env,item,stamp,'Pending',null,Math.min(3600,30*2**(item.attempts-1)));
      else await finish(env,item,stamp,'Dead',null);
    }
  }
}
