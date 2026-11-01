import type { Env } from './types';
import { json } from './http';

export function allowedSupportCheckoutUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'buy.stripe.com'
      && url.port === ''
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
      && /^\/[a-zA-Z0-9]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function supportAvailability(environment: Env['ENVIRONMENT'], checkoutUrl: string | undefined) {
  if (environment !== 'production' || !allowedSupportCheckoutUrl(checkoutUrl))
    return { enabled: false, checkoutUrl: null };
  return { enabled: true, checkoutUrl };
}

export function handleSupport(env: Env): Response {
  return json(supportAvailability(env.ENVIRONMENT, env.SUPPORT_CHECKOUT_URL));
}
