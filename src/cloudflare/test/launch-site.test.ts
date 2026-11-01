import { describe, expect, it } from 'vitest';
import launch, { type LaunchEnv } from '../src/launch-site';

const origin = 'https://daqqa-t-id.example';
const key = '1234567890abcdef1234567890abcdef';
const env: LaunchEnv = { PUBLIC_ORIGIN: origin, INDEXNOW_KEY: key };
const paths = ['/', '/how-it-works', '/join', '/contact', '/privacy'];
const get = (path: string, bindings = env, method = 'GET') => launch.fetch(new Request(`https://untrusted-host.example${path}`, { method }), bindings);

describe('public launch site for search engines', () => {
  it('renders crawlable pages with configured canonicals, no tracking and no fake marketplace inventory', async () => {
    for (const path of paths) {
      const response = await get(`${path}?src=referral`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('x-robots-tag')).toBeNull();
      expect(response.headers.get('set-cookie')).toBeNull();
      const html = await response.text();
      expect(html).toContain(`<link rel="canonical" href="${origin}${path}">`);
      expect(html).not.toContain('untrusted-host.example');
      expect(html).not.toContain('<form');
      expect(html).not.toContain('aggregateRating');
      expect(html).toContain('Real bookings are not open yet.');
      expect(html).toContain('<h1>');
    }
  });

  it('publishes only the five real pages in its absolute sitemap and allows crawlers', async () => {
    const robots = await (await get('/robots.txt')).text();
    expect(robots).toContain('Allow: /');
    expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(robots).not.toContain('Disallow: /');
    const xml = await (await get('/sitemap.xml')).text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    expect(urls).toEqual(paths.map(path => `${origin}${path}`));
    expect(xml).not.toContain('staging');
    expect(xml).not.toContain('/bookings');
  });

  it('serves the exact IndexNow proof and rejects unrelated or malformed keys', async () => {
    const response = await get(`/${key}.txt`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toBe(key);
    expect((await get('/not-the-key.txt')).status).toBe(404);
    expect((await get(`/${key}.txt`, { PUBLIC_ORIGIN: origin })).status).toBe(404);
    expect((await get('/bad_key_123.txt', { PUBLIC_ORIGIN: origin, INDEXNOW_KEY: 'bad_key_123' })).status).toBe(404);
  });

  it('renders only valid server-configured verification tags and prevents configuration injection', async () => {
    const html = await (await get('/', { ...env, GOOGLE_SITE_VERIFICATION: 'Google_public-code-123', BING_SITE_VERIFICATION: 'Bing_public_code_123' })).text();
    expect(html).toContain('<meta name="google-site-verification" content="Google_public-code-123">');
    expect(html).toContain('<meta name="msvalidate.01" content="Bing_public_code_123">');
    const invalid = await (await get('/?GOOGLE_SITE_VERIFICATION=query_override', { ...env, GOOGLE_SITE_VERIFICATION: '\"><script>alert(1)</script>', BING_SITE_VERIFICATION: 'bad code' })).text();
    expect(invalid).not.toContain('google-site-verification');
    expect(invalid).not.toContain('msvalidate.01');
    expect(invalid).not.toContain('query_override');
    expect(invalid).not.toContain('alert(1)');
  });

  it('keeps private and missing routes as true noindex 404s and rejects writes', async () => {
    for (const path of ['/api/session', '/bookings/123', '/missing', '/contact/']) {
      const response = await get(path);
      expect(response.status).toBe(404);
      expect(response.headers.get('x-robots-tag')).toContain('noindex');
    }
    const response = await get('/', env, 'POST');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('preserves headers/status but omits bodies for HEAD, including discovery documents', async () => {
    for (const path of ['/', '/favicon.svg', '/robots.txt', '/sitemap.xml', `/${key}.txt`, '/missing']) {
      const response = await get(path);
      const head = await get(path, env, 'HEAD');
      expect(head.status).toBe(response.status);
      expect([...head.headers]).toEqual([...response.headers]);
      expect(await head.text()).toBe('');
    }
  });

  it('fails closed for invalid canonical configuration', async () => {
    for (const value of ['', 'http://daqqa.example', 'https://user@daqqa.example', 'https://daqqa.example/path', 'https://daqqa.example?x=1']) {
      const response = await get('/', { PUBLIC_ORIGIN: value });
      expect(response.status).toBe(503);
      expect(response.headers.get('x-robots-tag')).toContain('noindex');
      expect(await response.text()).not.toContain(value || 'undefined');
    }
  });
});
