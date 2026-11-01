import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createContext, handleAuth, hashPassword, rateLimit, requireActor, validateCsrf, verifyPassword } from '../src/auth.js';
import type { Context, Env } from '../src/types.js';
import { HttpError } from '../src/http.js';

const cloudflareEnv = env as unknown as Env;

describe('ASP.NET Identity v3 password hashes', () => {
  it('produces a fixed Cloudflare PBKDF2-HMAC-SHA512 vector for .NET Identity verification', async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index);
    const fixture = 'AQAAAAIAAYagAAAAEAABAgMEBQYHCAkKCwwNDg9gCGUeHUoKYIJYMKBGgPKfmGVtN7rWUAXy9bnmzpeoZA==';
    expect(await hashPassword('Good-Password-2026', salt)).toBe(fixture);
    expect(await verifyPassword('Good-Password-2026', fixture)).toBe(true);
    expect(await verifyPassword('Good-Password-2025', fixture)).toBe(false);
  });

  it('writes Identity v3 format and verifies newly generated hashes', async () => {
    const encoded = await hashPassword('Good-Password-2026');
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    expect(bytes[0]).toBe(1);
    expect(new DataView(bytes.buffer).getUint32(1)).toBe(2);
    expect(new DataView(bytes.buffer).getUint32(5)).toBe(100_000);
    expect(new DataView(bytes.buffer).getUint32(9)).toBe(16);
    expect(await verifyPassword('Good-Password-2026', encoded)).toBe(true);
    expect(await verifyPassword('different password', encoded)).toBe(false);
  });
});

describe('session context and authorization helpers', () => {
  it('does not create an anonymous database session for an ordinary request', async () => {
    const before = await cloudflareEnv.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first<{ count: number }>();
    const context = await createContext(new Request('https://daqqa.test/api/catalog'), cloudflareEnv);
    const after = await cloudflareEnv.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first<{ count: number }>();
    expect(context.session).toBeNull();
    expect(context.actor).toBeNull();
    expect(after?.count).toBe(before?.count);
  });

  it('creates an anonymous session only through GET /api/session and sets a protected opaque cookie', async () => {
    const context = await createContext(new Request('https://daqqa.test/api/session'), cloudflareEnv);
    const response = await handleAuth(context);
    const body = await response?.json() as { user: unknown; csrfToken: string };
    const cookie = response?.headers.get('Set-Cookie') ?? '';
    expect(response?.status).toBe(200);
    expect(body.user).toBeNull();
    expect(body.csrfToken).toHaveLength(43);
    expect(cookie).toMatch(/^daqqa_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
    const stored = await cloudflareEnv.DB.prepare('SELECT user_id,csrf_token FROM sessions WHERE id_hash=?')
      .bind(context.session?.idHash).first<{ user_id: string | null; csrf_token: string }>();
    expect(stored).toEqual({ user_id: null, csrf_token: body.csrfToken });
  });

  it('increments per-scope limits in D1 and rejects the first request over the limit', async () => {
    const now = new Date();
    const context: Context = { request: new Request('https://daqqa.test/api/catalog'), env: cloudflareEnv,
      url: new URL('https://daqqa.test/api/catalog'), actor: null, session: null, cookies: [], now };
    const scope = `auth-test:${crypto.randomUUID()}`;
    await rateLimit(context, scope, 2, 60);
    await rateLimit(context, scope, 2, 60);
    await expect(rateLimit(context, scope, 2, 60)).rejects.toMatchObject({ status: 429 });
  });

  it('looks up an opaque cookie by its SHA-256 hash and resolves the user', async () => {
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = btoa(String.fromCharCode(...tokenBytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', tokenBytes))].map((value) => value.toString(16).padStart(2, '0')).join('');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await cloudflareEnv.DB.prepare(`INSERT INTO users (id,email,password_hash,security_stamp,display_name,phone,locality,role,is_suspended,
      failed_login_count,locked_until,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'Customer',0,0,NULL,?,?)`)
      .bind(id, `${id}@example.test`, 'unused', 'stamp', 'Test User', '+356 79000000', 'Mosta', now, now).run();
    await cloudflareEnv.DB.prepare('INSERT INTO sessions (id_hash,csrf_token,user_id,expires_at,created_at) VALUES (?,?,?,?,?)')
      .bind(hash, 'csrf-value', id, new Date(Date.now() + 60_000).toISOString(), now).run();

    const context = await createContext(new Request('https://daqqa.test/api/me', { headers: { Cookie: `daqqa_session=${token}` } }), cloudflareEnv);
    expect(context.session?.idHash).toBe(hash);
    expect(context.session?.userId).toBe(id);
    expect(context.actor).toMatchObject({ id, role: 'Customer', isSuspended: false });
    expect(context.cookies).toHaveLength(1);
  });

  it('checks the CSRF value and blocks unauthenticated, suspended, or wrong-role actors', async () => {
    const makeContext = (header: string): Context => ({
      request: new Request('https://daqqa.test/api/auth/login', { headers: { 'X-CSRF-TOKEN': header } }),
      env: cloudflareEnv, url: new URL('https://daqqa.test/api/auth/login'), actor: null,
      session: { idHash: 'hash', csrfToken: 'csrf-value', userId: null, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      cookies: [], now: new Date(),
    });
    await expect(validateCsrf(makeContext('wrong'))).rejects.toMatchObject({ status: 400 });
    await expect(validateCsrf(makeContext('csrf-value'))).resolves.toBeUndefined();
    expect(() => requireActor(makeContext('csrf-value'))).toThrow(HttpError);

    const suspended = makeContext('csrf-value');
    suspended.actor = { id: '1', email: 'a@example.test', displayName: 'A', phone: '', locality: '', role: 'Customer', isSuspended: true };
    expect(() => requireActor(suspended)).toThrowError('Account is suspended');
    const wrongRole = makeContext('csrf-value');
    wrongRole.actor = { ...suspended.actor, isSuspended: false };
    expect(() => requireActor(wrongRole, ['Admin'])).toThrow(HttpError);
  });
});
