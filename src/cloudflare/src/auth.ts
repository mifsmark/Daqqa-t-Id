import type { Actor, Context, Env, Role, Session } from './types';
import { HttpError, json, readJson } from './http';

const COOKIE_NAME = 'daqqa_session';
const SESSION_DAYS = 30;
const RESET_MINUTES = 30;
const LOCKOUT_MINUTES = 15;
const MAX_FAILED_LOGINS = 5;
const IDENTITY_ITERATIONS = 100_000;
const DUMMY_PASSWORD_HASH = 'AQAAAAIAAYagAAAAEAABAgMEBQYHCAkKCwwNDg9gCGUeHUoKYIJYMKBGgPKfmGVtN7rWUAXy9bnmzpeoZA==';
const encoder = new TextEncoder();

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  security_stamp: string;
  display_name: string;
  phone: string;
  locality: string;
  role: Role;
  is_suspended: number;
  failed_login_count: number;
  locked_until: string | null;
};

type SessionRow = {
  id_hash: string;
  csrf_token: string;
  user_id: string | null;
  expires_at: string;
};

export async function createContext(request: Request, env: Env): Promise<Context> {
  const url = new URL(request.url);
  const now = new Date();
  const cookies = (request.headers.get('Cookie') ?? '').split(';').map((part) => part.trim()).filter(Boolean);
  let session: Session | null = null;
  let actor: Actor | null = null;
  const cookie = cookies.find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (cookie) {
    const opaque = cookie.slice(COOKIE_NAME.length + 1);
    if (/^[A-Za-z0-9_-]{43}$/.test(opaque)) {
      const idHash = await sha256Hex(fromBase64Url(opaque));
      const row = await env.DB.prepare(
        'SELECT id_hash, csrf_token, user_id, expires_at FROM sessions WHERE id_hash = ? AND expires_at > ?'
      ).bind(idHash, now.toISOString()).first<SessionRow>();
      if (row) {
        session = { idHash: row.id_hash, csrfToken: row.csrf_token, userId: row.user_id, expiresAt: row.expires_at };
        if (row.user_id) {
          const user = await env.DB.prepare(
            'SELECT id, email, display_name, phone, locality, role, is_suspended FROM users WHERE id = ?'
          ).bind(row.user_id).first<Omit<UserRow, 'password_hash' | 'security_stamp' | 'failed_login_count' | 'locked_until'>>();
          if (user) actor = {
            id: user.id, email: user.email, displayName: user.display_name, phone: user.phone,
            locality: user.locality, role: user.role, isSuspended: user.is_suspended === 1,
          };
          else session = null;
        }
      }
    }
  }
  return { request, env, url, actor, session, cookies, now };
}

export async function validateCsrf(c: Context): Promise<void> {
  const supplied = c.request.headers.get('X-CSRF-TOKEN') ?? '';
  const expected = c.session?.csrfToken ?? '';
  if (!c.session || !constantTimeEqual(supplied, expected)) throw new HttpError(400, 'CSRF validation failed');
}

export function requireActor(c: Context, roles?: Role[]): Actor {
  if (!c.actor) throw new HttpError(401, 'Authentication is required');
  if (c.actor.isSuspended) throw new HttpError(403, 'Account is suspended');
  if (roles && !roles.includes(c.actor.role)) throw new HttpError(403, 'Forbidden');
  return c.actor;
}

/** Increment a fixed-window D1 rate limit atomically and reject over-limit requests. */
export async function rateLimit(c: Context, scope: string, limit = 120, windowSeconds = 60): Promise<void> {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1)
    throw new TypeError('Rate limit and window must be positive integers.');
  const key = await sha256Hex(encoder.encode(scope));
  const windowStart = new Date(Math.floor(c.now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
  const result = await c.env.DB.prepare(`INSERT INTO rate_limits (key,window_started_at,attempts,updated_at) VALUES (?,?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN rate_limits.window_started_at < excluded.window_started_at THEN 1 ELSE rate_limits.attempts + 1 END,
      window_started_at=excluded.window_started_at, updated_at=excluded.updated_at
    RETURNING attempts`).bind(key, windowStart, c.now.toISOString()).first<{ attempts: number }>();
  if (!result || result.attempts > limit) throw new HttpError(429, 'Too many requests. Try again later.');
}

export async function hashPassword(password: string, fixedSalt?: Uint8Array): Promise<string> {
  const salt = fixedSalt ? fixedSalt.slice() : crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new TypeError('Password salt must contain 16 bytes.');
  const derived = await derivePassword(password, salt, IDENTITY_ITERATIONS);
  const hash = new Uint8Array(13 + salt.length + derived.length);
  hash[0] = 1;
  writeU32(hash, 1, 2); // Identity V3 PRF: HMAC-SHA512.
  writeU32(hash, 5, IDENTITY_ITERATIONS);
  writeU32(hash, 9, salt.length);
  hash.set(salt, 13);
  hash.set(derived, 13 + salt.length);
  return bytesToBase64(hash);
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    const bytes = base64ToBytes(encodedHash);
    if (bytes.length < 14 || bytes[0] !== 1) return false;
    const prf = readU32(bytes, 1);
    const iterations = readU32(bytes, 5);
    const saltLength = readU32(bytes, 9);
    if (prf !== 2 || iterations < 1 || iterations > 2_000_000 || saltLength < 16 || bytes.length <= 13 + saltLength) return false;
    const salt = bytes.slice(13, 13 + saltLength);
    const expected = bytes.slice(13 + saltLength);
    const actual = await derivePassword(password, salt, iterations, expected.length);
    return constantTimeBytesEqual(actual, expected);
  } catch {
    return false;
  }
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number, length = 32): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt, iterations }, key, length * 8));
}

export async function handleAuth(c: Context): Promise<Response | undefined> {
  const path = c.url.pathname;
  if (path === '/api/session' && c.request.method === 'GET') return getSession(c);
  if (path === '/api/auth/demo') return json({ title: 'Not found', status: 404 }, 404);
  if (path === '/api/auth/register' && c.request.method === 'POST') return register(c);
  if (path === '/api/auth/login' && c.request.method === 'POST') return login(c);
  if (path === '/api/auth/logout' && c.request.method === 'POST') return logout(c);
  if (path === '/api/auth/forgot-password' && c.request.method === 'POST') return forgotPassword(c);
  if (path === '/api/auth/reset-password' && c.request.method === 'POST') return resetPassword(c);
  return undefined;
}

async function getSession(c: Context): Promise<Response> {
  if (!c.session) {
    const minted = await mintSession(c, null);
    c.session = minted.session;
    return jsonWithCookie(sessionBody(c.actor, minted.session.csrfToken), 200, minted.cookie);
  }
  if (c.actor?.isSuspended) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(c.session.idHash).run();
    c.actor = null;
    c.session = null;
    const minted = await mintSession(c, null);
    return jsonWithCookie(sessionBody(null, minted.session.csrfToken), 200, minted.cookie);
  }
  return json(sessionBody(c.actor, c.session.csrfToken));
}

function sessionBody(actor: Actor | null, csrfToken: string) {
  return {
    user: actor ? { id: actor.id, email: actor.email, displayName: actor.displayName, role: actor.role } : null,
    csrfToken,
    demoEnabled: false,
    stagingDemoEnabled: false,
  };
}

async function register(c: Context): Promise<Response> {
  await validateCsrf(c);
  const body = await readJson(c.request);
  const email = cleanString(body.email, 254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const displayName = cleanString(body.displayName, 100);
  const phone = cleanString(body.phone, 40);
  const locality = cleanString(body.locality, 100);
  const role = body.role;
  if (!validEmail(email) || password.length < 10 || password.length > 128 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)
    || displayName.length < 2 || phone.length < 6 || locality.length < 1 || (role !== 'Customer' && role !== 'Worker')) {
    throw new HttpError(400, 'Provide valid registration details. Passwords must be at least 10 characters and include an uppercase letter and a number.');
  }
  const supported = await c.env.DB.prepare('SELECT 1 AS found FROM localities WHERE name = ? COLLATE NOCASE').bind(locality).first<{ found: number }>();
  if (!supported) throw new HttpError(400, 'Choose a supported Malta or Gozo locality');
  const id = crypto.randomUUID();
  const stamp = randomToken();
  const passwordHash = await hashPassword(password);
  try {
    const statements = [c.env.DB.prepare(`INSERT INTO users (id, email, password_hash, security_stamp, display_name, phone, locality, role,
      is_suspended, failed_login_count, locked_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?)`)
      .bind(id, email, passwordHash, stamp, displayName, phone, locality, role, c.now.toISOString(), c.now.toISOString())];
    if (role === 'Worker') {
      statements.push(c.env.DB.prepare(`INSERT INTO workers (id,user_id,bio,locality,years_experience,radius_km,hourly_rate_cents,pricing_type,
        verification_status,available_now,availability_updated_at,is_demo,version,created_at,updated_at)
        VALUES (?,?, '', ?,0,10,0,'Hourly','Unverified',0,?,0,0,?,?)`)
        .bind(crypto.randomUUID(), id, locality, c.now.toISOString(), c.now.toISOString(), c.now.toISOString()));
    }
    await c.env.DB.batch(statements);
  } catch (error) {
    if (isUniqueConstraint(error)) throw new HttpError(409, 'An account with that email already exists');
    throw error;
  }
  const minted = await rotateSession(c, id);
  return jsonWithCookie(userBody({ id, email, display_name: displayName, role }), 200, minted.cookie);
}

async function login(c: Context): Promise<Response> {
  await validateCsrf(c);
  const body = await readJson(c.request);
  const email = cleanString(body.email, 254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!validEmail(email) || !password || password.length > 128) throw new HttpError(400, 'Email and password are required');
  const user = await c.env.DB.prepare(`SELECT id,email,password_hash,security_stamp,display_name,phone,locality,role,is_suspended,
    failed_login_count,locked_until FROM users WHERE email = ? COLLATE NOCASE`).bind(email).first<UserRow>();
  if (!user || user.is_suspended) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    throw new HttpError(401, 'Invalid email or password');
  }
  if (user.locked_until && Date.parse(user.locked_until) > c.now.getTime()) throw new HttpError(429, 'Account temporarily locked. Try again later.');
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const lockExpires = new Date(c.now.getTime() + LOCKOUT_MINUTES * 60_000).toISOString();
    await c.env.DB.prepare(`UPDATE users SET
      failed_login_count = CASE WHEN locked_until IS NOT NULL AND locked_until <= ? THEN 1 ELSE failed_login_count + 1 END,
      locked_until = CASE WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= ? THEN 1 ELSE failed_login_count + 1 END) >= ? THEN ? ELSE NULL END,
      updated_at = ? WHERE id = ?`)
      .bind(c.now.toISOString(), c.now.toISOString(), MAX_FAILED_LOGINS, lockExpires, c.now.toISOString(), user.id).run();
    throw new HttpError(401, 'Invalid email or password');
  }
  await c.env.DB.prepare('UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
    .bind(c.now.toISOString(), user.id).run();
  const minted = await rotateSession(c, user.id);
  return jsonWithCookie(userBody(user), 200, minted.cookie);
}

async function logout(c: Context): Promise<Response> {
  await validateCsrf(c);
  if (c.session) await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(c.session.idHash).run();
  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie(c) } });
}

async function forgotPassword(c: Context): Promise<Response> {
  await validateCsrf(c);
  const body = await readJson(c.request);
  const email = cleanString(body.email, 254).toLowerCase();
  if (!validEmail(email)) throw new HttpError(400, 'A valid email address is required');
  const token = randomToken();
  const tokenHash = await sha256Hex(encoder.encode(token));
  const user = await c.env.DB.prepare('SELECT id,email,is_suspended FROM users WHERE email = ? COLLATE NOCASE').bind(email).first<{ id: string; email: string; is_suspended: number }>();
  if (user && user.is_suspended === 0) {
    if (!c.env.MAIL_API_TOKEN || !c.env.MAIL_FROM) throw new HttpError(503, 'Password reset mail is not configured');
    const expires = new Date(c.now.getTime() + RESET_MINUTES * 60_000).toISOString();
    await c.env.DB.prepare('INSERT INTO password_reset_tokens (token_hash,user_id,expires_at,created_at,consumed_at) VALUES (?,?,?,?,NULL)')
      .bind(tokenHash, user.id, expires, c.now.toISOString()).run();
    const resetUrl = new URL('/reset-password', c.env.PUBLIC_ORIGIN || c.url.origin);
    resetUrl.searchParams.set('email', user.email);
    resetUrl.searchParams.set('token', token);
    const sent = await sendResetEmail(c.env.MAIL_API_TOKEN, c.env.MAIL_FROM, user.email, resetUrl.toString());
    if (!sent) {
      await c.env.DB.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').bind(tokenHash).run();
      throw new HttpError(503, 'Password reset mail is temporarily unavailable');
    }
  } else if (!c.env.MAIL_API_TOKEN || !c.env.MAIL_FROM) {
    throw new HttpError(503, 'Password reset mail is not configured');
  }
  return json({ message: 'If an account exists for that email, password reset instructions have been sent.' });
}

async function resetPassword(c: Context): Promise<Response> {
  await validateCsrf(c);
  const body = await readJson(c.request);
  const email = cleanString(body.email, 254).toLowerCase();
  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!validEmail(email) || !token || token.length > 128 || !validPassword(password)) {
    throw new HttpError(400, 'The reset link is invalid or expired, or the password does not meet account requirements');
  }
  const tokenHash = await sha256Hex(encoder.encode(token));
  const row = await c.env.DB.prepare(`SELECT t.token_hash,t.user_id FROM password_reset_tokens t
    JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>? AND t.consumed_at IS NULL
    AND u.email=? COLLATE NOCASE AND u.is_suspended=0`).bind(tokenHash, c.now.toISOString(), email)
    .first<{ token_hash: string; user_id: string }>();
  if (!row) throw new HttpError(400, 'The reset link is invalid or expired, or the password does not meet account requirements');
  const passwordHash = await hashPassword(password);
  const newStamp = randomToken();
  const consumed = await c.env.DB.prepare('UPDATE password_reset_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?')
    .bind(c.now.toISOString(), tokenHash, c.now.toISOString()).run();
  if (consumed.meta.changes !== 1) throw new HttpError(400, 'The reset link is invalid or expired, or the password does not meet account requirements');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash=?,security_stamp=?,failed_login_count=0,locked_until=NULL,updated_at=? WHERE id=?')
      .bind(passwordHash, newStamp, c.now.toISOString(), row.user_id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id),
    c.env.DB.prepare('DELETE FROM password_reset_tokens WHERE user_id=?').bind(row.user_id),
  ]);
  return json({ message: 'Your password has been changed. You can now sign in.' });
}

async function sendResetEmail(apiToken: string, from: string, to: string, link: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: 'Reset your Daqqa t’Id password',
        text: `Use this link to choose a new password:\n\n${link}\n\nIf you did not request this change, you can ignore this email.` }),
    });
    return response.ok;
  } catch { return false; }
}

async function mintSession(c: Context, userId: string | null): Promise<{ session: Session; cookie: string }> {
  const opaque = randomToken();
  const idHash = await sha256Hex(fromBase64Url(opaque));
  const csrfToken = randomToken();
  const expiresAt = new Date(c.now.getTime() + SESSION_DAYS * 24 * 60 * 60_000).toISOString();
  await c.env.DB.prepare('INSERT INTO sessions (id_hash,csrf_token,user_id,expires_at,created_at) VALUES (?,?,?,?,?)')
    .bind(idHash, csrfToken, userId, expiresAt, c.now.toISOString()).run();
  return { session: { idHash, csrfToken, userId, expiresAt }, cookie: sessionCookie(c, opaque) };
}

async function rotateSession(c: Context, userId: string): Promise<{ session: Session; cookie: string }> {
  if (c.session) await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(c.session.idHash).run();
  const minted = await mintSession(c, userId);
  c.session = minted.session;
  return minted;
}

function sessionCookie(c: Context, value: string): string {
  const secure = !(c.env.ENVIRONMENT === 'development' && isLoopback(c.url.hostname));
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure ? '; Secure' : ''}`;
}

function jsonWithCookie(value: unknown, status: number, cookie: string): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': cookie } });
}

function clearCookie(c: Context): string {
  const secure = !(c.env.ENVIRONMENT === 'development' && isLoopback(c.url.hostname));
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function userBody(user: Pick<UserRow, 'id' | 'email' | 'display_name' | 'role'>) {
  return { id: user.id, email: user.email, displayName: user.display_name, role: user.role };
}

function cleanString(value: unknown, max: number): string {
  return typeof value === 'string' && value.length <= max ? value.trim() : '';
}

function validEmail(value: string): boolean { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validPassword(value: string): boolean { return value.length >= 10 && value.length <= 128 && /[A-Z]/.test(value) && /[0-9]/.test(value); }
function isLoopback(host: string): boolean { return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'; }
function isUniqueConstraint(error: unknown): boolean { return error instanceof Error && /unique constraint/i.test(error.message); }

function randomToken(): string { return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32))); }
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function bytesToBase64Url(bytes: Uint8Array): string { return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  return base64ToBytes(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}
async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', value));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function constantTimeEqual(a: string, b: string): boolean { return constantTimeBytesEqual(encoder.encode(a), encoder.encode(b)); }
function constantTimeBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  // CSRF values are 32-byte base64url tokens (43 ASCII chars). Compare a
  // fixed-size buffer so malformed short/long headers do not change the work.
  const length = 128;
  if (a.length > length || b.length > length) difference |= 1;
  for (let i = 0; i < length; i++) difference |= (a[i % (a.length || 1)] ?? 0) ^ (b[i % (b.length || 1)] ?? 0);
  return difference === 0;
}
function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 255; bytes[offset + 1] = (value >>> 16) & 255;
  bytes[offset + 2] = (value >>> 8) & 255; bytes[offset + 3] = value & 255;
}
function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}
