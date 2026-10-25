export type Role = 'Customer' | 'Worker' | 'Admin';
export interface Env {
  DB: D1Database;
  MEDIA: KVNamespace;
  ASSETS: Fetcher;
  PUBLIC_ORIGIN?: string;
  ENVIRONMENT?: 'development' | 'staging' | 'production';
  STAGING_DEMO_ENABLED?: string;
  STAGING_DEMO_DATABASE_NAME?: string;
  SUPPORT_CHECKOUT_URL?: string;
  MAIL_API_TOKEN?: string;
  MAIL_FROM?: string;
  VAPID_SERVER_PUBLIC_KEY?: string;
  VAPID_SERVER_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}
export interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; }
export interface Actor {
  id: string;
  email: string;
  displayName: string;
  phone: string;
  locality: string;
  role: Role;
  isSuspended: boolean;
}
export interface Session {
  idHash: string;
  csrfToken: string;
  userId: string | null;
  expiresAt: string;
}
export interface Context {
  request: Request;
  env: Env;
  url: URL;
  actor: Actor | null;
  session: Session | null;
  cookies: string[];
  now: Date;
}
export interface HourRow { weekday: number; start_time: string; end_time: string }
export interface ExceptionRow { date: string; is_available: number }
export interface WorkerRow {
  id: string; user_id: string; display_name: string; bio: string; locality: string;
  radius_km: number; hourly_rate_cents: number; pricing_type: string;
  verification_status: string; available_now: number; version: number;
}
