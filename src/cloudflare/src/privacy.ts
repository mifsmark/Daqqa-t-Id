/** Privacy request choices accepted by POST /api/me/privacy-request. */
export type PrivacyRequestKind = 'Export' | 'Delete';

/**
 * Return a canonical request kind, rejecting malformed JSON values and aliases.
 * The API contract intentionally keeps these names in PascalCase.
 */
export function parsePrivacyRequestKind(value: unknown): PrivacyRequestKind | null {
  if (typeof value !== 'string') return null;
  const kind = value.trim();
  return kind === 'Export' || kind === 'Delete' ? kind : null;
}

export const PRIVACY_REQUEST_MESSAGE = 'Your privacy request has been recorded.';
