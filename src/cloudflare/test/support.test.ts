import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';
import { allowedSupportCheckoutUrl, supportAvailability } from '../src/support';

describe('optional support checkout policy', () => {
  const link = 'https://buy.stripe.com/abc123';

  it('keeps support disabled outside production even with a valid URL', () => {
    expect(supportAvailability('staging', link)).toEqual({ enabled: false, checkoutUrl: null });
    expect(supportAvailability('development', link)).toEqual({ enabled: false, checkoutUrl: null });
  });

  it('enables only a configured production payment link', () => {
    expect(supportAvailability('production', link)).toEqual({ enabled: true, checkoutUrl: link });
    expect(supportAvailability('production', undefined)).toEqual({ enabled: false, checkoutUrl: null });
  });

  it('serves the public support contract and keeps staging disabled', async () => {
    const bindings = { ...env, ENVIRONMENT: 'staging' as const, SUPPORT_CHECKOUT_URL: link };
    const response = await worker.fetch(new Request('https://daqqatid.example/api/support'), bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, checkoutUrl: null });
  });

  it.each([
    'http://buy.stripe.com/abc', 'https://buy.stripe.com/test_abc',
    'https://user@buy.stripe.com/abc', 'https://buy.stripe.com.evil.example/abc',
    'https://buy.stripe.com:444/abc', 'https://buy.stripe.com/abc?amount=1',
    'https://buy.stripe.com/abc#return', 'https://buy.stripe.com/',
  ])('fails closed for invalid URL %s', url => {
    expect(allowedSupportCheckoutUrl(url)).toBe(false);
    expect(supportAvailability('production', url).enabled).toBe(false);
  });
});
