/** @jest-environment node */

import { clientAdProxyEpisodes } from './client-ad-proxy';
import { buildHlsAdProxyUrl, prepareHlsPlaybackUrl } from './hls-playback-url';

const origin = 'http://192.168.1.10:3000';
const raw = 'https://video.test/index.m3u8?sign=a%2Bb&expires=1';
const options = { origin, source: 'cms-key', token: 'test-proxy-token' };

test('web playback uses the shared server filter whenever ad blocking is enabled', () => {
  const url = new URL(
    prepareHlsPlaybackUrl(raw, { ...options, adBlock: true }),
    origin
  );
  expect(url.pathname).toBe('/api/proxy-m3u8');
  expect(url.searchParams.get('url')).toBe(raw);
  expect(prepareHlsPlaybackUrl(raw, { ...options, adBlock: false })).toBe(raw);
});

test('keeps signed URLs, source and token through one proxy even after repeated wrapping', () => {
  const first = buildHlsAdProxyUrl(raw, options);
  const second = buildHlsAdProxyUrl(first, options);
  expect(first).toBe(second);
  const url = new URL(second, origin);
  expect(url.searchParams.get('url')).toBe(raw);
  expect(url.searchParams.get('source')).toBe('cms-key');
  expect(url.searchParams.get('token')).toBe('test-proxy-token');
});

test('retains full transport proxying and respects a disabled filter without adding another proxy', () => {
  const vod =
    '/api/proxy/vod/m3u8?' +
    new URLSearchParams({ url: raw, source: 'cms-key' });
  const proxy = prepareHlsPlaybackUrl(vod, {
    ...options,
    adBlock: true,
    serverFilter: true,
  });
  expect(new URL(proxy, origin).searchParams.get('proxySegments')).toBe('true');
  expect(new URL(proxy, origin).searchParams.get('url')).toBe(raw);
  const disabled = prepareHlsPlaybackUrl(proxy, { ...options, adBlock: false });
  expect(new URL(disabled, origin).searchParams.get('adblock')).toBe('false');
  expect(
    prepareHlsPlaybackUrl(raw, {
      ...options,
      adBlock: false,
      serverFilter: true,
    })
  ).toBe(raw);
});

test('keeps local/offline files and non-HLS media usable', () => {
  for (const input of [
    'blob:https://video.test/id',
    'https://video.test/movie.mp4',
    '/api/offline-download/local/playlist.m3u8',
  ])
    expect(buildHlsAdProxyUrl(input, options)).toBe(input);
});

test('APP/OrionTV rules add authentication and source only to selected HLS sources', () => {
  const episodes = [raw, 'https://video.test/movie.mp4'];
  const result = clientAdProxyEpisodes(episodes, {
    ...options,
    userAgent: 'OrionTV',
    enabledSources: ['cms-key'],
  });
  expect(result?.[0]).toContain('token=test-proxy-token');
  expect(result?.[0]).toContain('source=cms-key');
  expect(result?.[1]).toBe(episodes[1]);
  expect(
    clientAdProxyEpisodes(episodes, {
      ...options,
      userAgent: 'Browser',
      enabledSources: ['cms-key'],
    })
  ).toBe(episodes);
});
