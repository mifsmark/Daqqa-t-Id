export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

export type SupportedImageType = 'image/png' | 'image/jpeg' | 'image/webp';

/** Identify allowed formats from the bytes, never from the multipart MIME header. */
export function detectImageType(bytes: Uint8Array): SupportedImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
    && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a
    && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

/** Keep only a short basename; never persist client-supplied path fragments. */
export function safeOriginalName(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  const basename = name.replaceAll('\\', '/').split('/').at(-1) ?? '';
  if (!basename || basename === '.' || basename === '..') return null;
  return basename.slice(0, 260);
}

export function extensionForImageType(type: SupportedImageType): '.png' | '.jpg' | '.webp' {
  switch (type) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/webp': return '.webp';
  }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let result = '';
  for (let i = start; i < start + length; i++) result += String.fromCharCode(bytes[i]);
  return result;
}
