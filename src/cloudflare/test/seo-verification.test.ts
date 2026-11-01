import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/types';

describe('search ownership verification metadata', () => {
  const bindings = (values: Partial<Env> = {}): Env => ({
    DB: env.DB,
    MEDIA: env.MEDIA,
    ASSETS: env.ASSETS,
    PUBLIC_ORIGIN: env.PUBLIC_ORIGIN,
    ENVIRONMENT: 'production',
    ...values,
  });

  it('renders valid configured Google and Bing tokens only on production pages', async () => {
    const production = bindings({
      GOOGLE_SITE_VERIFICATION: 'Google_token-1234',
      BING_SITE_VERIFICATION: 'Bing_token-123456',
    });
    const page = await worker.fetch(new Request('https://daqqa.test/'), production);
    const html = await page.text();
    expect(html).toContain('<meta name="google-site-verification" content="Google_token-1234">');
    expect(html).toContain('<meta name="msvalidate.01" content="Bing_token-123456">');
    expect(page.headers.get('X-Robots-Tag')).toBeNull();
    const robots = await worker.fetch(new Request('https://daqqa.test/robots.txt'), production);
    expect(await robots.text()).toContain('/sitemap.xml');

    const staging = await worker.fetch(new Request('https://daqqa.test/'), bindings({
      ENVIRONMENT: 'staging',
      STAGING_DEMO_ENABLED: 'true',
      GOOGLE_SITE_VERIFICATION: 'Google_token-1234',
      BING_SITE_VERIFICATION: 'Bing_token-123456',
    }));
    const stagingHtml = await staging.text();
    expect(stagingHtml).not.toContain('google-site-verification');
    expect(stagingHtml).not.toContain('msvalidate.01');
    expect(stagingHtml).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(staging.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect((await worker.fetch(new Request('https://daqqa.test/robots.txt'), bindings({ ENVIRONMENT: 'staging', STAGING_DEMO_ENABLED: 'true' }))).headers.get('X-Robots-Tag'))
      .toBe('noindex, nofollow');
    expect((await worker.fetch(new Request('https://daqqa.test/sitemap.xml'), bindings({ ENVIRONMENT: 'staging', STAGING_DEMO_ENABLED: 'true' }))).status)
      .toBe(404);
  });

  it('omits invalid configured values and never reads tokens from the request', async () => {
    const response = await worker.fetch(new Request('https://daqqa.test/?google_site_verification=Query_token-1234'), bindings({
      GOOGLE_SITE_VERIFICATION: 'bad" ><meta name="injected" content="x',
      BING_SITE_VERIFICATION: 'Bing_token\n',
    }));
    const html = await response.text();
    expect(html).not.toContain('google-site-verification');
    expect(html).not.toContain('msvalidate.01');
    expect(html).not.toContain('name="injected"');
    expect(html).not.toContain('Query_token-1234');
  });
});
