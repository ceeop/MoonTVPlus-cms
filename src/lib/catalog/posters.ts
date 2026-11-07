import { createHash } from 'crypto';
import { decode } from 'he';

export const POSTER_PREFIX = '/api/catalog/posters/';
export const MAX_POSTER_BYTES = 1024 * 1024;

export function normalizeCatalogPosterUrl(value: string): string {
  let url = value.trim();
  for (let i = 0; i < 3; i++) {
    const decoded = decode(url);
    if (decoded === url) break;
    url = decoded;
  }
  return url.startsWith('//') ? `https:${url}` : url;
}

export function catalogPosterId(url: string): string | null {
  if (!url) return null;
  const id = url.startsWith(POSTER_PREFIX)
    ? url.slice(POSTER_PREFIX.length)
    : /^https?:\/\//i.test(url)
    ? createHash('sha256').update(url).digest('hex')
    : '';
  return /^[a-f0-9]{64}$/.test(id) ? id : null;
}

// Check the bytes as well as the response headers; HTML/SVG must never be served as a poster.
function imageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return 'image/jpeg';
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii')))
    return 'image/gif';
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  if (
    bytes.subarray(4, 8).toString('ascii') === 'ftyp' &&
    /^(avif|avis)$/.test(bytes.subarray(8, 12).toString('ascii'))
  )
    return 'image/avif';
  return null;
}

export async function downloadCatalogPoster(url: string) {
  url = normalizeCatalogPosterUrl(url);
  if (!/^https?:\/\//i.test(url)) return null;
  const imageUrl = new URL(url);
  const referer = imageUrl.hostname.endsWith('.doubanio.com')
    ? 'https://movie.douban.com/'
    : `${imageUrl.origin}/`;
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
    headers: {
      Accept: 'image/*',
      'User-Agent': 'Mozilla/5.0',
      Referer: referer,
    },
  });
  if (!response.ok || !response.body) return null;
  if (Number(response.headers.get('content-length')) > MAX_POSTER_BYTES) {
    await response.body.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      const value = chunk.value;
      size += value.byteLength;
      if (size > MAX_POSTER_BYTES) return null;
      chunks.push(Buffer.from(value));
      chunk = await reader.read();
    }
  } finally {
    await reader.cancel();
  }
  const bytes = Buffer.concat(chunks);
  const contentType = imageType(bytes);
  return contentType ? { contentType, data: bytes.toString('base64') } : null;
}
