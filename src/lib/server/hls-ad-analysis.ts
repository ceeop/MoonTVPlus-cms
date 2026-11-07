import { createHash } from 'crypto';

import { filterAdsFromM3U8 } from '@/lib/hls-ad-filter';
import type { HlsSegmentIdentity } from '@/lib/hls-ad-segments';
import {
  hlsMediaGroups,
  hlsSegmentIdentity,
  unmarkedAdSegments,
} from '@/lib/hls-ad-segments';

import { validateProxyUrlServerSide } from './ssrf';

const PREFIX_BYTES = 16384;
const PROBE_CONCURRENCY = 16;
const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map<string, { expires: number; result: Promise<string> }>();

async function probe(
  url: string,
  signal: AbortSignal
): Promise<HlsSegmentIdentity | null> {
  for (let redirect = 0; redirect < 3; redirect++) {
    if (
      signal.aborted ||
      !(await validateProxyUrlServerSide(url)) ||
      signal.aborted
    )
      return null;
    const response = await fetch(url, {
      headers: {
        Range: `bytes=0-${PREFIX_BYTES - 1}`,
        Referer: new URL(url).origin + '/',
        'User-Agent': 'Mozilla/5.0',
      },
      signal,
      redirect: 'manual',
      cache: 'no-store',
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) return null;
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(PREFIX_BYTES);
    let size = 0;
    try {
      while (size < PREFIX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        const part = value.subarray(0, PREFIX_BYTES - size);
        bytes.set(part, size);
        size += part.length;
        const identity = hlsSegmentIdentity(bytes.subarray(0, size));
        if (identity) return identity;
      }
      return null;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  return null;
}

/** Shared by web/native players and TVBox via the playlist proxy, for every source. */
export async function filterUnmarkedHlsAds(
  content: string,
  baseUrl: string
): Promise<string> {
  const groups = hlsMediaGroups(content);
  if (!groups.length) return content;
  const key = createHash('sha256')
    .update(baseUrl)
    .update(content)
    .digest('hex');
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.result;
  const controller = new AbortController();
  const identities: Array<HlsSegmentIdentity | null> = groups.map(() => null);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve();
    }, 10000);
  });
  const result = (async () => {
    try {
      let nextGroup = 0;
      const probeGroups = async () => {
        while (nextGroup < groups.length && !controller.signal.aborted) {
          const index = nextGroup++;
          try {
            identities[index] = await probe(
              new URL(groups[index].segments[0], baseUrl).href,
              controller.signal
            );
          } catch {
            // A missing group only limits verification of the neighboring timeline.
          }
        }
      };
      const analysis = Promise.all(
        Array.from(
          { length: Math.min(groups.length, PROBE_CONCURRENCY) },
          probeGroups
        )
      );
      await Promise.race([analysis, budget]);
      if (identities.some((identity) => !identity)) cache.delete(key);
      const removed = unmarkedAdSegments(groups, identities);
      return removed.size
        ? filterAdsFromM3U8('', content, undefined, removed)
        : content;
    } catch {
      cache.delete(key);
      return content;
    } finally {
      clearTimeout(timeout);
    }
  })();
  for (const [entry, value] of Array.from(cache.entries()))
    if (value.expires <= Date.now()) cache.delete(entry);
  if (cache.size >= 64) cache.delete(cache.keys().next().value as string);
  cache.set(key, { expires: Date.now() + CACHE_TTL, result });
  return result;
}
