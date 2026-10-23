import type { Context } from './types';
import { json } from './http';

const PRIVATE_PATHS = new Set([
  '/find', '/login', '/register', '/forgot-password', '/reset-password', '/dashboard', '/worker',
  '/account', '/admin', '/privacy', '/terms', '/bookings/new',
]);
const STAGING = (c: Context) => c.env.ENVIRONMENT === 'staging' && c.env.STAGING_DEMO_ENABLED === 'true';

/** Server-render index metadata and crawlable text for the SEO page routes. */
export async function handleSeo(c: Context): Promise<Response | undefined> {
  const path = c.url.pathname;
  const method = c.request.method;
  if (path === '/robots.txt' && method === 'GET') return robots(c);
  if (path === '/sitemap.xml' && method === 'GET') return sitemap(c);
  if (method !== 'GET' && method !== 'HEAD') return undefined;
  if (path.startsWith('/api/')) return undefined;
  if (path === '/') return renderPage(c, {
    title: 'Daqqa t’Id | Find local help in Malta & Gozo',
    description: 'Find local help. Get things done. Browse local services, request a clear price, or join as a worker in Malta and Gozo.',
    canonicalPath: '/',
    body: '<main><h1>Find local help. Get things done.</h1><p>Daqqa t’Id connects people with local service workers in Malta and Gozo.</p><p>Book help, work alongside a professional on eligible tasks, or learn a practical skill.</p><a href="/services">Explore services</a> <a href="/join">Join as a worker</a></main>',
    schema: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Daqqa t’Id', url: origin(c), inLanguage: 'en-MT' },
  });
  if (path === '/join') return renderPage(c, {
    title: 'Find local customers for your skills | Daqqa t’Id',
    description: 'Join as a service worker in Malta and Gozo. Set your services, area and availability, review requests, and agree a price before starting.',
    canonicalPath: '/join',
    body: '<main><h1>Your skills can help your neighbours.</h1><p>Create a worker account, choose your services and area, and let people know when you are available.</p><ol><li>Add your name and contact details.</li><li>Choose your skills, service area and pricing.</li><li>Review requests and agree a job before you start.</li></ol><p>Regulated services require professional verification. Demo payments do not collect or transfer money.</p><a href="/register?role=Worker">Join as a worker</a></main>',
  });
  if (path === '/services') return servicesPage(c);
  const categoryMatch = path.match(/^\/services\/([^/]+)$/);
  if (categoryMatch) return categoryPage(c, categoryMatch[1]);
  const workerMatch = path.match(/^\/workers\/([^/]+)$/);
  if (workerMatch) return workerPage(c, workerMatch[1]);
  if (PRIVATE_PATHS.has(path) || /^\/bookings\/[0-9a-f-]{36}$/i.test(path)) {
    const title = privateTitle(path);
    return renderPage(c, { title: `${title} | Daqqa t’Id`, description: 'Daqqa t’Id services in Malta and Gozo.', canonicalPath: path, body: '', noindex: true });
  }
  // This function is called after API and static asset routes. Unknown document paths
  // must stay a real 404 instead of falling through to the SPA index document.
  return json({ title: 'Not found', status: 404 }, 404);
}

async function servicesPage(c: Context): Promise<Response> {
  const categories = await c.env.DB.prepare('SELECT id,slug,name,description FROM categories WHERE is_active=1 ORDER BY name COLLATE NOCASE').all<{
    id: string; slug: string; name: string; description: string;
  }>();
  const body = '<main><h1>Local services in Malta and Gozo</h1><p>Find a helping hand around your home.</p><ul>' +
    categories.results.map(x => `<li><a href="/services/${encodeURIComponent(x.slug)}">${escapeHtml(x.name)}</a><p>${escapeHtml(x.description)}</p></li>`).join('') + '</ul></main>';
  return renderPage(c, { title: 'Local services in Malta & Gozo | Daqqa t’Id',
    description: 'Browse home services in Malta and Gozo, from cleaning and furniture assembly to verified professional work.',
    canonicalPath: '/services', body });
}

async function categoryPage(c: Context, encodedSlug: string): Promise<Response> {
  let slug: string;
  try { slug = decodeURIComponent(encodedSlug); } catch { return notFound(); }
  const category = await c.env.DB.prepare(`SELECT id,slug,name,description,requires_verification FROM categories WHERE slug=? AND is_active=1`)
    .bind(slug).first<{ id: string; slug: string; name: string; description: string; requires_verification: number }>();
  if (!category) return notFound();
  const count = await c.env.DB.prepare(`SELECT COUNT(DISTINCT w.id) AS count FROM workers w JOIN users u ON u.id=w.user_id
    JOIN offerings o ON o.worker_id=w.id JOIN categories c ON c.id=o.category_id
    WHERE o.category_id=? AND c.is_active=1 AND w.is_demo=0 AND w.verification_status<>'Suspended' AND u.is_suspended=0
      AND (c.requires_verification=0 OR w.verification_status='Verified')`).bind(category.id).first<{ count: number }>();
  const description = `${category.description} Find local help in Malta and Gozo. Compare service options and request a clear price before confirming.`;
  const content = category.requires_verification
    ? '<p>This service requires an approved professional. Customer participation and lessons are restricted to eligible activities.</p>'
    : '<p>Choose professional help, work together, or learn a practical skill where this service supports it.</p>';
  const body = `<main><h1>${escapeHtml(category.name)} in Malta and Gozo</h1><p>${escapeHtml(description)}</p>${content}` +
    `<a href="/find?categoryId=${encodeURIComponent(category.id)}">Find ${escapeHtml(category.name.toLowerCase())} help</a>` +
    '<p>Requests are subject to the worker’s acceptance and your confirmation. Prices and availability are shown by each provider. Demo profiles and simulated payments are clearly labelled.</p><a href="/join">Offer your skills</a></main>';
  return renderPage(c, { title: `${category.name} in Malta & Gozo | Daqqa t’Id`, description,
    canonicalPath: `/services/${encodeURIComponent(category.slug)}`, body,
    noindex: (count?.count ?? 0) === 0 && !STAGING(c),
    follow: (count?.count ?? 0) === 0,
    schema: { '@context': 'https://schema.org', '@type': 'Service', name: category.name, description: category.description,
      areaServed: ['Malta', 'Gozo'], provider: { name: 'Daqqa t’Id', url: origin(c) } },
  });
}

async function workerPage(c: Context, workerId: string): Promise<Response> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workerId)) return notFound();
  const worker = await c.env.DB.prepare(`SELECT w.id,u.display_name,w.bio,w.locality,w.verification_status,w.is_demo FROM workers w
    JOIN users u ON u.id=w.user_id WHERE w.id=? AND w.verification_status<>'Suspended' AND u.is_suspended=0`)
    .bind(workerId).first<{ id: string; display_name: string; bio: string; locality: string; verification_status: string; is_demo: number }>();
  if (!worker) return notFound();
  const description = truncate(`${worker.display_name}, local service worker in ${worker.locality}. ${worker.bio}`, 280);
  const body = `<main><h1>${escapeHtml(worker.display_name)}</h1><p>Based in ${escapeHtml(worker.locality)}, Malta and Gozo.</p><p>${escapeHtml(worker.bio)}</p>` +
    (worker.is_demo ? '<p>Fictional demo provider. This profile is for testing and does not represent a real available worker.</p>' : '') +
    `<p>Verification status: ${escapeHtml(worker.verification_status)}. Worker-declared availability is not live tracking.</p><a href="/bookings/new?workerId=${encodeURIComponent(worker.id)}">Request this helper</a></main>`;
  return renderPage(c, { title: `${worker.display_name} in ${worker.locality} | Daqqa t’Id`, description,
    canonicalPath: `/workers/${worker.id}`, body, noindex: worker.is_demo === 1 });
}

async function robots(c: Context): Promise<Response> {
  const staging = STAGING(c);
  const body = staging
    ? 'User-agent: *\nDisallow: /\n'
    : 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /account\nDisallow: /dashboard\nDisallow: /worker$\nDisallow: /bookings/\nDisallow: /find\n' +
      (origin(c) ? `Sitemap: ${origin(c)}/sitemap.xml\n` : '');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300', ...(staging ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}) } });
}

async function sitemap(c: Context): Promise<Response> {
  if (STAGING(c)) return notFound();
  const publicOrigin = origin(c);
  if (!publicOrigin) return json({ title: 'Service unavailable', detail: 'PUBLIC_ORIGIN must be configured before publishing the sitemap.', status: 503 }, 503);
  const records = await c.env.DB.prepare(`
    SELECT '/' AS path UNION ALL SELECT '/services' UNION ALL SELECT '/join'
    UNION SELECT '/services/'||c.slug FROM categories c WHERE c.is_active=1 AND EXISTS (
      SELECT 1 FROM offerings o JOIN workers w ON w.id=o.worker_id JOIN users u ON u.id=w.user_id
      WHERE o.category_id=c.id AND w.is_demo=0 AND w.verification_status<>'Suspended' AND u.is_suspended=0
        AND (c.requires_verification=0 OR w.verification_status='Verified'))
    UNION SELECT '/workers/'||w.id FROM workers w JOIN users u ON u.id=w.user_id
      WHERE w.is_demo=0 AND w.verification_status<>'Suspended' AND u.is_suspended=0 AND EXISTS (
        SELECT 1 FROM offerings o JOIN categories c ON c.id=o.category_id WHERE o.worker_id=w.id AND c.is_active=1
          AND (c.requires_verification=0 OR w.verification_status='Verified'))
  `).all<{ path: string }>();
  const urls = records.results.map(row => `<url><loc>${escapeXml(publicOrigin + row.path)}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}

interface PageOptions { title: string; description: string; canonicalPath: string; body: string; schema?: unknown; noindex?: boolean; follow?: boolean }
async function renderPage(c: Context, page: PageOptions): Promise<Response> {
  const url = new URL('/index.html', c.url.origin);
  const asset = await c.env.ASSETS.fetch(new Request(url, { headers: { Accept: 'text/html' } }));
  if (!asset.ok) return json({ title: 'Service unavailable', detail: 'The frontend assets are unavailable.', status: 503 }, 503);
  let html = await asset.text();
  const title = escapeHtml(page.title), description = escapeHtml(page.description);
  const canonical = origin(c) ? `${origin(c)}${page.canonicalPath}` : null;
  const tags = `<meta name="description" content="${description}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta name="twitter:card" content="summary">` +
    (canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:url" content="${escapeHtml(canonical)}">` : '') +
    (page.noindex || STAGING(c) ? `<meta name="robots" content="noindex, ${page.follow && !STAGING(c) ? 'follow' : 'nofollow'}">` : '') +
    (page.schema === undefined ? '' : `<script type="application/ld+json">${safeJson(page.schema)}</script>`);
  html = html.replace(/<title>.*?<\/title>/is, `<title>${title}</title>`)
    .replace(/<meta\s+name=["']description["'][^>]*>/i, '')
    .replace('</head>', `${tags}</head>`)
    .replace(/<div id="root"><\/div>/, `<div id="root">${page.body}</div>`);
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  if (page.noindex || STAGING(c)) headers.set('X-Robots-Tag', `noindex, ${page.follow && !STAGING(c) ? 'follow' : 'nofollow'}`);
  return new Response(c.request.method === 'HEAD' ? null : html, { headers });
}

function origin(c: Context): string | null {
  if (!c.env.PUBLIC_ORIGIN) return null;
  try {
    const value = c.env.PUBLIC_ORIGIN;
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch { return null; }
}
function privateTitle(path: string): string {
  const titles: Record<string, string> = { '/find': 'Find local help', '/login': 'Sign in', '/register': 'Create an account',
    '/forgot-password': 'Reset your password', '/reset-password': 'Reset your password', '/dashboard': 'Dashboard', '/worker': 'Worker profile',
    '/account': 'Your account', '/admin': 'Administration', '/privacy': 'Privacy', '/terms': 'Terms', '/bookings/new': 'Request a service' };
  return titles[path] ?? 'Booking';
}
function truncate(value: string, length: number): string { return value.length <= length ? value : `${value.slice(0, length - 1)}…`; }
function safeJson(value: unknown): string { return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029'); }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function escapeXml(value: string): string { return escapeHtml(value); }
function notFound(): Response { return json({ title: 'Not found', status: 404 }, 404); }
