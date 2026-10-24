import type { Context, Env } from './types';
import { createContext, handleAuth, rateLimit, requireActor, validateCsrf } from './auth';
import { handleCatalog } from './catalog';
import { handleBookings } from './bookings';
import { handleMedia } from './media';
import { handleAdmin } from './admin';
import { handleSeo } from './seo';
import { HttpError, json, problem } from './http';

const demoFlags = (env: Env) => env.ENVIRONMENT === 'staging' && env.STAGING_DEMO_ENABLED === 'true';
export async function isStagingDemo(env: Env): Promise<boolean> {
  if (!demoFlags(env) || !env.STAGING_DEMO_DATABASE_NAME?.endsWith('_staging_demo')) return false;
  const marker = await env.DB.prepare("SELECT key,value FROM deployment_info WHERE key IN ('database_name','environment')").all<{ key: string; value: string }>();
  return marker.results.some(x => x.key === 'database_name' && x.value === env.STAGING_DEMO_DATABASE_NAME)
    && marker.results.some(x => x.key === 'environment' && x.value === 'staging');
}
function finish(response: Response, request: Request, env: Env): Response {
  const result = new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('X-Frame-Options', 'DENY');
  result.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  result.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; worker-src 'self'; manifest-src 'self'");
  const path = new URL(request.url).pathname;
  if (path.startsWith('/api/') || path === '/api') result.headers.set('Cache-Control', 'no-store');
  if (demoFlags(env) || /^\/(api|admin|account|dashboard|worker|bookings|login|register|reset-password|forgot-password|find)(\/|$)/.test(path))
    result.headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (new URL(request.url).protocol === 'https:') result.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return result;
}
function failure(error: unknown): Response {
  if (error instanceof HttpError) return problem(error.status, error.message);
  const message = error instanceof Error ? error.message : '';
  const conflicts = [
    ['worker_time_conflict', 'Worker is already booked for that time.'],
    ['worker_suspended', 'Worker is unavailable.'], ['customer_suspended', 'Customer account is suspended.'],
    ['category_mode_unavailable', 'Category is inactive or does not support this mode.'],
    ['worker_offering_unavailable', 'Worker does not offer this service and mode.'],
    ['worker_verification_required', 'This service requires a verified worker.'],
    ['worker_not_available_now', 'Worker is not currently available.'],
    ['booking_eligibility_changed', 'Category or worker is no longer eligible.'],
    ['invalid_booking_transition', 'This booking action is no longer available.'],
    ['booking_version_conflict', 'Booking changed. Refresh and try again.'],
    ['UNIQUE constraint failed', 'This request was already processed or conflicts with an existing record.'],
  ];
  for (const [key, detail] of conflicts) if (message.includes(key)) return problem(409, detail);
  // Never log SQL bindings, request bodies, password hashes or credentials.
  console.error('Marketplace request failed', { errorType: error instanceof Error ? error.name : 'Unknown' });
  return problem(503, 'The service is temporarily unavailable. Please try again.');
}
async function dispatch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/health/live') return json({ status: 'live' });
  if (path === '/health/ready') {
    const ready = await env.DB.prepare("SELECT id FROM settings WHERE id=1").first();
    return ready ? json({ status: 'ready' }) : problem(503, 'Apply the reviewed database migrations first.');
  }
  if (path.startsWith('/api/') || path === '/api') {
    if (path === '/api/admin/staging-demo/fixture' && !await isStagingDemo(env)) return problem(404, 'Not found.');
    const c = await createContext(request, env);
    // Read the actor's current suspension state on every protected API request.
    if (c.actor?.isSuspended && path !== '/api/session' && path !== '/api/auth/logout') requireActor(c);
    const clientIp = request.headers.get('CF-Connecting-IP') || 'local';
    await rateLimit(c, `api:${c.actor?.id ?? clientIp}`);
    if (path.startsWith('/api/auth/') && request.method === 'POST') await rateLimit(c, `auth:${clientIp}`, 10);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) await validateCsrf(c);
    let response = await handleAuth(c);
    if (response && path === '/api/session' && request.method === 'GET') {
      const body = await response.json() as Record<string, unknown>;
      response = new Response(JSON.stringify({ ...body, demoEnabled: false, stagingDemoEnabled: await isStagingDemo(env) }), { status: response.status, headers: response.headers });
    }
    response ??= await handleCatalog(c);
    response ??= await handleBookings(c);
    response ??= await handleMedia(c);
    response ??= await handleAdmin(c);
    return response ?? problem(404, 'Not found.');
  }
  // Static assets and public pages do not create sessions or write to D1.
  if (path === '/offline.html' || path.startsWith('/assets/') || /^\/(?:[^/]+\.(?:svg|png|ico|webp|jpg|jpeg|js|css|webmanifest|woff2?|txt))$/.test(path) && path !== '/robots.txt')
    return env.ASSETS.fetch(request);
  const c: Context = { request, env, url, actor: null, session: null, cookies: [], now: new Date() };
  const page = await handleSeo(c);
  if (page) return page;
  return env.ASSETS.fetch(request);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return finish(await dispatch(request, env), request, env); }
    catch (error) { return finish(failure(error), request, env); }
  },
};
