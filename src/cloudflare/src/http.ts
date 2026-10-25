export class HttpError extends Error {
  constructor(public readonly status: number, detail: string) { super(detail); }
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function problem(status: number, detail: string): Response {
  return Response.json({ status, title: status >= 500 ? 'Service unavailable' : 'Request could not be completed', detail },
    { status, headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' } });
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    throw new HttpError(415, 'Send a JSON request.');
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 64 * 1024) throw new HttpError(413, 'Request is too large.');
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, 'Invalid JSON request.'); }
}
export function text(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    throw new HttpError(400, `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
export function numeric(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new HttpError(400, `${label} must be between ${min} and ${max}.`);
  return value;
}
export function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new HttpError(400, `Choose a valid ${label}.`);
  return value as T;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new HttpError(400, 'A valid ID is required.');
  return value;
}
export function euroToCents(value: unknown, label = 'Price'): number {
  const amount = numeric(value, label, 0, 100000);
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) throw new HttpError(400, `${label} supports at most two decimal places.`);
  return Math.round(amount * 100);
}
export async function sha256(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function rows<T>(statement: D1PreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}
export function changed(result: D1Result): void {
  if (result.meta.changes !== 1) throw new HttpError(409, 'This record changed. Refresh and try again.');
}
