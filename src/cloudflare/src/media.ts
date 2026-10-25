import { requireActor } from './auth';
import { HttpError, json, readJson } from './http';
import { detectImageType, extensionForImageType, MAX_MEDIA_BYTES, safeOriginalName } from './media-helpers';
import { parsePrivacyRequestKind, PRIVACY_REQUEST_MESSAGE } from './privacy';
import type { Context } from './types';

const PRIVATE_BOOKING_STATUSES = ['Confirmed', 'InProgress', 'Completed'] as const;
const MAX_DAILY_UPLOADS_PER_USER = 10;
const MAX_MULTIPART_OVERHEAD = 128 * 1024;

type MediaRow = {
  id: string;
  owner_id: string;
  purpose: 'avatar' | 'portfolio' | 'booking';
  booking_id: string | null;
  content_type: string;
  storage_key: string;
  original_name: string | null;
  size_bytes: number;
};

type BookingRow = { id: string; customer_id: string; worker_user_id: string; status: string };

/** Handles media and the privacy-request endpoint; returns undefined for other paths. */
export async function handleMedia(c: Context): Promise<Response | undefined> {
  const path = c.url.pathname;
  if (path === '/api/me/privacy-request' && c.request.method === 'POST') return handlePrivacy(c);
  if (path === '/api/media' && c.request.method === 'POST') return uploadMedia(c);

  const mediaMatch = path.match(/^\/api\/media\/([0-9a-f-]{36})$/i);
  if (mediaMatch && c.request.method === 'GET') return readMedia(c, mediaMatch[1]);
  const workerMatch = path.match(/^\/api\/workers\/([0-9a-f-]{36})\/media$/i);
  if (workerMatch && c.request.method === 'GET') return listWorkerMedia(c, workerMatch[1]);
  const bookingMatch = path.match(/^\/api\/bookings\/([0-9a-f-]{36})\/media$/i);
  if (bookingMatch && c.request.method === 'GET') return listBookingMedia(c, bookingMatch[1]);
  return undefined;
}

export async function handlePrivacy(c: Context): Promise<Response | undefined> {
  if (c.url.pathname !== '/api/me/privacy-request' || c.request.method !== 'POST') return undefined;
  const actor = requireActor(c, ['Customer', 'Worker']);
  const body = await readJson(c.request);
  const kind = parsePrivacyRequestKind(body.kind);
  if (!kind) throw new HttpError(400, 'Kind must be Export or Delete.');
  await c.env.DB.prepare('INSERT INTO privacy_requests (id,user_id,kind,status,created_at) VALUES (?,?,?,\'Open\',?)')
    .bind(crypto.randomUUID(), actor.id, kind, c.now.toISOString()).run();
  return json({ message: PRIVACY_REQUEST_MESSAGE });
}

async function uploadMedia(c: Context): Promise<Response> {
  const actor = requireActor(c, ['Customer', 'Worker']);
  if (!c.request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data;'))
    throw new HttpError(400, 'Expected multipart form data.');
  const contentLength = Number(c.request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES + MAX_MULTIPART_OVERHEAD)
    throw new HttpError(400, 'Image exceeds the 5 MB request limit.');

  let form: FormData;
  try {
    const bytes = await readBoundedBody(c.request, MAX_MEDIA_BYTES + MAX_MULTIPART_OVERHEAD);
    const headers = new Headers(c.request.headers);
    headers.delete('Content-Length');
    headers.delete('Transfer-Encoding');
    const buffered = new Request(c.request.url, { method: 'POST', headers, body: bytes });
    form = await buffered.formData();
  }
  catch { throw new HttpError(400, 'Invalid multipart upload.'); }
  const files = [...form.values()].filter((value): value is File => value instanceof File);
  if (files.length !== 1 || form.getAll('file').length !== 1)
    throw new HttpError(400, 'Upload one image at a time.');
  const purposeValue = form.get('purpose');
  const purpose = typeof purposeValue === 'string' ? purposeValue.trim().toLowerCase() : '';
  const bookingValue = form.get('bookingId');
  const bookingIdText = typeof bookingValue === 'string' ? bookingValue.trim() : '';
  let bookingId: string | null = null;
  if (purpose === 'avatar' || purpose === 'portfolio') {
    if (actor.role !== 'Worker' || bookingIdText) throw new HttpError(400, 'Invalid media purpose.');
    const worker = await c.env.DB.prepare('SELECT 1 AS found FROM workers WHERE user_id=?').bind(actor.id).first<{ found: number }>();
    if (!worker) throw new HttpError(403, 'A worker profile is required for profile media.');
  } else if (purpose === 'booking') {
    if (!isUuid(bookingIdText)) throw new HttpError(400, 'A bookingId is required.');
    const booking = await getBooking(c, bookingIdText);
    if (!booking || !isBookingParticipant(booking, actor.id)) throw new HttpError(404, 'Booking not found.');
    if (!isPrivateStatus(booking.status)) throw new HttpError(409, 'Booking images are available after confirmation.');
    bookingId = bookingIdText;
  } else {
    throw new HttpError(400, 'Purpose must be avatar, portfolio, or booking.');
  }

  const file = files[0];
  if (file.size <= 0 || file.size > MAX_MEDIA_BYTES) throw new HttpError(400, 'Image must be between 1 byte and 5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_MEDIA_BYTES)
    throw new HttpError(400, 'Image must be between 1 byte and 5 MB.');
  const contentType = detectImageType(bytes);
  if (!contentType) throw new HttpError(400, 'Only PNG, JPEG, and WebP images are accepted.');

  const today = c.now.toISOString().slice(0, 10);
  const daily = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM media WHERE owner_id=? AND created_at>=? AND created_at<?')
    .bind(actor.id, `${today}T00:00:00.000Z`, `${nextUtcDay(today)}T00:00:00.000Z`).first<{ count: number }>();
  if ((daily?.count ?? 0) >= MAX_DAILY_UPLOADS_PER_USER)
    throw new HttpError(429, 'The daily image upload limit has been reached. Try again tomorrow.');

  const id = crypto.randomUUID();
  const storageKey = `${crypto.randomUUID().replaceAll('-', '')}${extensionForImageType(contentType)}`;
  await c.env.MEDIA.put(storageKey, bytes, { metadata: { contentType } });
  try {
    await c.env.DB.prepare(`INSERT INTO media (id,owner_id,purpose,booking_id,content_type,storage_key,original_name,created_at,size_bytes)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(id, actor.id, purpose, bookingId, contentType, storageKey, safeOriginalName(file.name), c.now.toISOString(), bytes.byteLength).run();
  } catch (error) {
    // KV and D1 cannot share a transaction; remove the byte object if metadata did not commit.
    try { await c.env.MEDIA.delete(storageKey); } catch { /* Leave no new DB row; orphan cleanup can retry. */ }
    throw error;
  }
  return json({ id, url: `/api/media/${id}`, contentType }, 201);
}

async function readMedia(c: Context, id: string): Promise<Response> {
  const media = await c.env.DB.prepare(`SELECT id,owner_id,purpose,booking_id,content_type,storage_key,original_name,size_bytes
    FROM media WHERE id=?`).bind(id).first<MediaRow>();
  if (!media) throw new HttpError(404, 'Media not found.');

  // Decide access entirely from D1 before touching KV. Booking bytes are private even if
  // the requester guesses a valid media id.
  let allowed = false;
  if (media.booking_id === null && (media.purpose === 'avatar' || media.purpose === 'portfolio')) {
    const publicWorker = await c.env.DB.prepare(`SELECT 1 AS found FROM workers w JOIN users u ON u.id=w.user_id
      WHERE w.user_id=? AND w.verification_status<>'Suspended' AND u.is_suspended=0`).bind(media.owner_id).first<{ found: number }>();
    allowed = Boolean(publicWorker);
  }
  if (!allowed) {
    const actor = c.actor && !c.actor.isSuspended ? c.actor : null;
    if (!actor || !media.booking_id) throw new HttpError(404, 'Media not found.');
    const booking = await getBooking(c, media.booking_id);
    if (!booking || !isPrivateStatus(booking.status) || !isBookingParticipant(booking, actor.id))
      throw new HttpError(404, 'Media not found.');
  }
  if (!isStorageKey(media.storage_key)) throw new HttpError(404, 'Media not found.');
  const object = await c.env.MEDIA.get(media.storage_key, 'arrayBuffer');
  if (!object) throw new HttpError(404, 'Media not found.');
  return new Response(object, { headers: {
    'Content-Type': media.content_type,
    'Content-Length': String(media.size_bytes),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
}

async function listWorkerMedia(c: Context, workerId: string): Promise<Response> {
  const worker = await c.env.DB.prepare(`SELECT w.user_id FROM workers w JOIN users u ON u.id=w.user_id
    WHERE w.id=? AND w.verification_status<>'Suspended' AND u.is_suspended=0`).bind(workerId).first<{ user_id: string }>();
  if (!worker) throw new HttpError(404, 'Worker not found.');
  const result = await c.env.DB.prepare(`SELECT id,content_type,purpose FROM media
    WHERE owner_id=? AND booking_id IS NULL AND purpose IN ('avatar','portfolio') ORDER BY created_at`)
    .bind(worker.user_id).all<{ id: string; content_type: string; purpose: string }>();
  return json(result.results.map(row => ({ id: row.id, url: `/api/media/${row.id}`, contentType: row.content_type, purpose: row.purpose })));
}

async function listBookingMedia(c: Context, bookingId: string): Promise<Response> {
  const actor = requireActor(c);
  const booking = await getBooking(c, bookingId);
  if (!booking || !isPrivateStatus(booking.status) || !isBookingParticipant(booking, actor.id))
    throw new HttpError(404, 'Booking not found.');
  const result = await c.env.DB.prepare(`SELECT id,content_type,purpose FROM media WHERE booking_id=? AND purpose='booking' ORDER BY created_at`)
    .bind(bookingId).all<{ id: string; content_type: string; purpose: string }>();
  return json(result.results.map(row => ({ id: row.id, url: `/api/media/${row.id}`, contentType: row.content_type, purpose: row.purpose })));
}

async function getBooking(c: Context, bookingId: string): Promise<BookingRow | null> {
  return c.env.DB.prepare(`SELECT b.id,b.customer_id,b.status,w.user_id AS worker_user_id FROM bookings b
    JOIN workers w ON w.id=b.worker_id WHERE b.id=?`).bind(bookingId).first<BookingRow>();
}

function isBookingParticipant(booking: BookingRow, userId: string): boolean {
  return booking.customer_id === userId || booking.worker_user_id === userId;
}
function isPrivateStatus(status: string): boolean { return (PRIVATE_BOOKING_STATUSES as readonly string[]).includes(status); }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
function isStorageKey(value: string): boolean { return /^[a-f0-9]{32}\.(?:png|jpg|webp)$/.test(value); }
function nextUtcDay(day: string): string { return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10); }

async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) throw new HttpError(400, 'An image is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new HttpError(400, 'Image exceeds the 5 MB request limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}
