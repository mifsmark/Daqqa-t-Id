import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.PUBLIC_LAUNCH_BASE_URL || 'http://127.0.0.1:8791';
const canonical = JSON.parse(readFileSync(new URL('../../src/cloudflare/wrangler.launch.jsonc', import.meta.url), 'utf8')).vars.PUBLIC_ORIGIN;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, javaScriptEnabled: false });
  const page = await context.newPage();
  for (const path of ['/', '/how-it-works', '/join', '/contact', '/privacy']) {
    const response = await page.goto(base + path);
    assert.equal(response.status(), 200, `${path} is unavailable`);
    assert.equal(response.headers()['x-robots-tag'], undefined, `${path} must be indexable`);
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), canonical + path);
    // JavaScript is disabled deliberately: these are actual crawlable documents.
    const overflow = await page.locator('body').evaluate(body => body.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `${path} overflows a 375px phone`);
    assert.equal(await page.locator('form').count(), 0);
  }
  await page.goto(base + '/contact');
  assert.equal(await page.locator('main a[href^="mailto:"]').getAttribute('href'), 'mailto:markanthonymifsud@yahoo.com');
  assert.equal(await page.locator('main a[href^="https://wa.me/"]').getAttribute('href'), 'https://wa.me/35699894619');
  await page.goto(base);
  const schema = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  assert.deepEqual(schema['@graph'].map(item => item['@type']), ['Organization', 'WebSite']);
  assert.equal(JSON.stringify(schema).includes('aggregateRating'), false);
  if (process.env.PUBLIC_LAUNCH_SCREENSHOT) await page.screenshot({ path: process.env.PUBLIC_LAUNCH_SCREENSHOT, fullPage: true });
  assert.equal((await context.cookies()).length, 0);
  console.log('Public launch smoke passed: five crawlable documents without JavaScript, canonical URLs, mobile layout, contact links and honest schema.');
} finally {
  await browser.close();
}
