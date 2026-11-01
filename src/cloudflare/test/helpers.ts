import { env, SELF } from 'cloudflare:test';

export type Json = Record<string, any>;

export class Actor {
  private cookies = new Map<string, string>();
  csrfToken = '';

  constructor(readonly email = `cloudflare-${crypto.randomUUID()}@example.test`, readonly password = 'Good-Password-2026') {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    return this.requestWith(path, init, request => SELF.fetch(request));
  }

  async requestWith(path: string, init: RequestInit, send: (request: Request) => Promise<Response>): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('Cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await send(new Request(`https://daqqa.test${path}`, { ...init, headers }));
    const setCookies = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
    for (const setCookie of setCookies) {
      const pair = setCookie.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }

  async json(path: string, init: RequestInit = {}): Promise<{ response: Response; body: Json }> {
    const response = await this.request(path, init);
    const text = await response.text();
    let body: Json = {};
    if (text) {
      try { body = JSON.parse(text) as Json; }
      catch { body = { text }; }
    }
    return { response, body };
  }

  async mutate(path: string, body: unknown, method = 'POST'): Promise<Response> {
    return this.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': this.csrfToken },
      body: JSON.stringify(body),
    });
  }

  async session(): Promise<Json> {
    const { response, body } = await this.json('/api/session');
    if (response.ok && typeof body.csrfToken === 'string') this.csrfToken = body.csrfToken;
    return body;
  }

  async register(role: 'Customer' | 'Worker' = 'Customer'): Promise<void> {
    await this.session();
    const { response, body } = await this.json('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': this.csrfToken },
      body: JSON.stringify({ email: this.email, password: this.password, displayName: `Test ${role}`, phone: '+356 79000000', locality: 'Mosta', role }),
    });
    if (!response.ok) throw new Error(`Register ${role} failed (${response.status}): ${JSON.stringify(body)}`);
    await this.session();
  }

  async login(): Promise<void> {
    await this.session();
    const { response, body } = await this.json('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': this.csrfToken },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!response.ok) throw new Error(`Login failed (${response.status}): ${JSON.stringify(body)}`);
    await this.session();
  }

  async makeAdmin(): Promise<void> {
    await env.DB.prepare("UPDATE users SET role = 'Admin' WHERE email = ?").bind(this.email).run();
    await this.request('/api/auth/logout', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': this.csrfToken }, body: '{}',
    });
    this.cookies.clear();
    await this.login();
  }
}

export async function registeredActor(role: 'Customer' | 'Worker' = 'Customer'): Promise<Actor> {
  const actor = new Actor();
  await actor.register(role);
  return actor;
}

export async function registeredAdmin(): Promise<Actor> {
  const actor = new Actor(`admin-${crypto.randomUUID()}@example.test`);
  await actor.register('Customer');
  await actor.makeAdmin();
  return actor;
}

export const CLEANING_CATEGORY_ID = '174f21df-55ab-5467-9f57-5ca5e2e0f0ab';

export function futureStartAt(daysFromNow: number): string {
  const start = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  start.setUTCHours(10, 0, 0, 0);
  return start.toISOString();
}

export async function createWorker(actor: Actor, options: { pricingType?: 'Hourly' | 'Fixed' | 'Quote'; modes?: string[]; availableNow?: boolean; categoryIds?: string[] } = {}): Promise<string> {
  const profile = await actor.mutate('/api/worker/profile', {
    displayName: 'Integration Worker', bio: 'A real D1 integration fixture.', locality: 'Mosta', yearsExperience: 7,
    radiusKm: 20, hourlyRate: 35, categoryIds: options.categoryIds ?? [CLEANING_CATEGORY_ID],
    modes: options.modes ?? ['ForMe', 'WithMe', 'TeachMe'], pricingType: options.pricingType ?? 'Quote',
  }, 'PUT');
  const data = await profile.json().catch(() => ({})) as Json;
  if (!profile.ok || !data.id) throw new Error(`Worker profile failed (${profile.status}): ${JSON.stringify(data)}`);
  const hours = await actor.mutate('/api/worker/availability', {
    availableNow: options.availableNow ?? false,
    windows: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:59' })),
    exceptions: [],
  }, 'PUT');
  if (!hours.ok) throw new Error(`Worker availability failed (${hours.status}): ${await hours.text()}`);
  return data.id as string;
}

export function bookingRequest(workerId: string, mode: string, extra: Partial<Json> = {}): Json {
  return {
    workerId, categoryId: CLEANING_CATEGORY_ID, mode, summary: `Test ${mode} service`,
    description: 'A safe household task for an integration test.', address: '17 Private Lane', locality: 'Mosta',
    startAt: futureStartAt(3), durationMinutes: 60,
    isAsap: false, idempotencyKey: crypto.randomUUID(), ...extra,
  };
}

export async function json(response: Response): Promise<Json> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text) as Json; }
  catch { return { text }; }
}
