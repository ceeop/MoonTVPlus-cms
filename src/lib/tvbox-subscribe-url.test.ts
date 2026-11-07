/** @jest-environment node */

import { buildTVBoxSubscribeUrl } from './tvbox-subscribe-url';

test('subscription URLs contain only per-client options and preserve opaque tokens', () => {
  const url = new URL(
    buildTVBoxSubscribeUrl('https://app.test', 'opaque&token', {})
  );
  expect(url.searchParams.get('token')).toBe('opaque&token');
  expect(url.searchParams.has('m3u8Only')).toBe(false);
  expect(url.searchParams.has('adFilter')).toBe(false);
  expect(url.searchParams.get('cloudFilter')).toBe('true');
  const off = new URL(
    buildTVBoxSubscribeUrl('https://app.test', 'token', {
      adFilter: true,
      cloudFilter: false,
    })
  );
  expect(off.searchParams.has('m3u8Only')).toBe(false);
  expect(off.searchParams.get('adFilter')).toBe('true');
  expect(off.searchParams.get('cloudFilter')).toBe('false');
});
