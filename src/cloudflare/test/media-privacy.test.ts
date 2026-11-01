import { describe, expect, it } from 'vitest';
import { detectImageType, MAX_MEDIA_BYTES, safeOriginalName } from '../src/media-helpers.js';
import { parsePrivacyRequestKind, PRIVACY_REQUEST_MESSAGE } from '../src/privacy.js';

describe('media byte validation helpers', () => {
  it('recognizes PNG, JPEG, and WebP signatures', () => {
    expect(detectImageType(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe('image/png');
    expect(detectImageType(Uint8Array.from([255, 216, 255, 0]))).toBe('image/jpeg');
    expect(detectImageType(Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]))).toBe('image/webp');
  });

  it('rejects truncated or unsupported signatures', () => {
    expect(detectImageType(Uint8Array.from([137, 80, 78, 71]))).toBeNull();
    expect(detectImageType(Uint8Array.from([71, 73, 70, 56, 57, 97]))).toBeNull();
  });

  it('sets the shared five MiB upload bound and sanitizes client filenames', () => {
    expect(MAX_MEDIA_BYTES).toBe(5 * 1024 * 1024);
    expect(safeOriginalName('C:\\private\\portrait.png')).toBe('portrait.png');
    expect(safeOriginalName('../secret.txt')).toBe('secret.txt');
    expect(safeOriginalName('')).toBeNull();
    expect(safeOriginalName('x'.repeat(300))).toHaveLength(260);
  });
});

describe('privacy request validation', () => {
  it('accepts only the contract enum spellings', () => {
    expect(parsePrivacyRequestKind('Export')).toBe('Export');
    expect(parsePrivacyRequestKind('Delete')).toBe('Delete');
    expect(parsePrivacyRequestKind(' export ')).toBeNull();
    expect(parsePrivacyRequestKind('Erase')).toBeNull();
    expect(parsePrivacyRequestKind(null)).toBeNull();
  });

  it('uses the API contract response message', () => {
    expect(PRIVACY_REQUEST_MESSAGE).toBe('Your privacy request has been recorded.');
  });
});
