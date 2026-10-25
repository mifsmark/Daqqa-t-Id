export type Role = "Customer" | "Worker" | "Admin";
export type User = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
};
export type Session = {
  user: User | null;
  csrfToken: string;
  demoEnabled: boolean;
  stagingDemoEnabled?: boolean;
};
export type Category = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  modes: string[];
  requiresVerification: boolean;
  isActive: boolean;
};
export type Worker = {
  id: string;
  userId: string;
  displayName: string;
  bio: string;
  locality: string;
  yearsExperience: number;
  verificationStatus: string;
  availableNow: boolean;
  availabilityUpdatedAt: string;
  isDemo: boolean;
  hourlyRate: number;
  pricingType: string;
  categoryIds: string[];
  modes: string[];
  reviewCount: number;
  averageRating: number | null;
};
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (csrf) headers.set("X-CSRF-TOKEN", csrf);
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.detail || body.title || "Something went wrong. Please try again.",
    );
  return body as T;
}
export const json = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});
