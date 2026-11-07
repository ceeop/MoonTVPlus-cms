/** @jest-environment node */

import type { NextRequest } from 'next/server';
import { Headers } from 'node-fetch';

import { getConfig } from '@/lib/config';
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';
import { TVBOX_HLS_PATH, tvboxHlsParams, tvboxHlsUrl } from '@/lib/tvbox/hls';

import { GET as GETTVBoxPlaylist } from './playlist.m3u8/route';
import { GET } from './route';

jest.mock('next/server', () => ({
  NextResponse: class {
    status: number;
    headers: Headers;
    constructor(
      private body: string,
      init?: { status?: number; headers?: Record<string, string> }
    ) {
      this.status = init?.status || 200;
      this.headers = new (jest.requireActual('node-fetch').Headers)(
        init?.headers
      );
    }
    text = async () => this.body;
    json = async () => JSON.parse(this.body);
    static json(body: unknown, init?: { status?: number }) {
      return new this(JSON.stringify(body), init);
    }
  },
}));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/server/ssrf', () => ({
  validateProxyUrlServerSide: jest.fn(),
}));

const input = [
  '#EXTM3U',
  '#EXTINF:6,',
  'main0.ts',
  '#EXT-X-DISCONTINUITY',
  '#EXT-X-CUE-OUT:DURATION=18',
  '#EXTINF:6,',
  '/stream/hash/index0.ts',
  '#EXTINF:6,',
  '/stream/hash/index1.ts',
  '#EXTINF:6,',
  '/stream/hash/index2.ts',
  '#EXT-X-CUE-IN',
  '#EXT-X-DISCONTINUITY',
  '#EXTINF:6,',
  'main1.ts',
  '#EXT-X-ENDLIST',
].join('\n');
const upstream = (
  content = input,
  url = 'https://cdn.test/final/playlist.m3u8'
) => ({
  ok: true,
  url,
  headers: new Headers({ 'content-type': 'application/vnd.apple.mpegurl' }),
  text: async () => content,
});
const originalEnvironment = { ...process.env };
const originalFetch = global.fetch;
afterAll(() => {
  process.env = originalEnvironment;
  global.fetch = originalFetch;
});
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN;
  delete process.env.SITE_BASE;
  (getConfig as jest.Mock).mockResolvedValue({ SiteConfig: {} });
  (validateProxyUrlServerSide as jest.Mock).mockResolvedValue(true);
  global.fetch = jest.fn().mockResolvedValue(upstream());
});
const get = (options: Record<string, string> = {}) =>
  GET({
    url:
      'http://192.168.1.10:3000/api/proxy-m3u8?' +
      new URLSearchParams({
        url: 'https://origin.test/start.m3u8',
        ...options,
      }),
    headers: new Headers({ host: '192.168.1.10:3000' }),
  } as unknown as NextRequest);

test('filters a CUE-marked ad break, resolves redirected paths, and leaves media downloads direct', async () => {
  const response = await get();
  expect(response.status).toBe(200);
  const content = await response.text();
  expect(content).not.toContain('/stream/hash/');
  expect(content).toContain('https://cdn.test/final/main0.ts');
  expect(content).toContain('https://cdn.test/final/main1.ts');
  expect(content).not.toContain('/api/proxy/vod/segment');
  expect(content).toContain('#EXT-X-DISCONTINUITY');
  expect(response.headers.get('content-type')).toBe(
    'application/vnd.apple.mpegurl'
  );
  expect(global.fetch).toHaveBeenCalledWith(
    'https://origin.test/start.m3u8',
    expect.objectContaining({ cache: 'no-store' })
  );
});

test('adblock=false keeps the ad segments and skips custom-rule configuration', async () => {
  const response = await get({ adblock: 'false' });
  expect(await response.text()).toContain(
    'https://cdn.test/stream/hash/index0.ts'
  );
  expect(getConfig).not.toHaveBeenCalled();
});

test('nested video and audio playlists retain filtering options, tokens and the HTTP site origin', async () => {
  process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN = 'test-proxy-token';
  const master =
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio?lang=zh"\n#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO="a"\n//video.test/LEVEL.M3U8?sig=keep';
  (global.fetch as jest.Mock).mockResolvedValue(upstream(master));
  const response = await get({
    source: 'cms-key',
    token: 'test-proxy-token',
    adblock: 'false',
    proxySegments: 'true',
  });
  const lines = (await response.text()).split('\n');
  const audio = new URL(lines[1].match(/URI="([^"]+)"/)?.[1] || '');
  const video = new URL(lines[3]);
  expect(audio.searchParams.get('url')).toBe(
    'https://cdn.test/final/audio?lang=zh'
  );
  expect(video.searchParams.get('url')).toBe(
    'https://video.test/LEVEL.M3U8?sig=keep'
  );
  for (const url of [audio, video]) {
    expect(url.origin).toBe('http://192.168.1.10:3000');
    expect(url.pathname).toBe('/api/proxy-m3u8');
    expect(url.searchParams.get('source')).toBe('cms-key');
    expect(url.searchParams.get('token')).toBe('test-proxy-token');
    expect(url.searchParams.get('adblock')).toBe('false');
    expect(url.searchParams.get('proxySegments')).toBe('true');
    expect(url.searchParams.get('analysis')).toBe('false');
  }
});

test('applies source-specific custom rules', async () => {
  (getConfig as jest.Mock).mockResolvedValue({
    SiteConfig: {
      CustomAdFilterCode:
        'function filterAdsFromM3U8(type, content) { return type === "cms-key" ? content.replace("main0.ts", "matched.ts") : content; }',
    },
  });
  const response = await get({ source: 'cms-key' });
  expect(await response.text()).toContain('https://cdn.test/final/matched.ts');
});

test('keeps token and upstream network validation before fetching', async () => {
  process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN = 'test-proxy-token';
  expect((await get()).status).toBe(401);
  (validateProxyUrlServerSide as jest.Mock).mockResolvedValue(false);
  expect((await get({ token: 'test-proxy-token' })).status).toBe(403);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('TVBox playback keeps recognizable HLS paths on nested playlists and still validates auth', async () => {
  process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN = 'https-secret';
  const origin = 'http://192.168.1.10:3000';
  const params = new URLSearchParams({
    url: 'https://upstream.test/index.m3u8?key=a%2Bb',
    source: 'tv-source',
  });
  const request = (url: string) =>
    ({
      url,
      headers: new Headers({ host: '192.168.1.10:3000' }),
    } as unknown as NextRequest);
  expect(
    (await GETTVBoxPlaylist(request(`${origin}${TVBOX_HLS_PATH}?id=!`))).status
  ).toBe(400);
  expect(
    (await GETTVBoxPlaylist(request(tvboxHlsUrl(origin, params)))).status
  ).toBe(401);
  expect(global.fetch).not.toHaveBeenCalled();

  params.set('token', 'https-secret');
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    upstream('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlevel.m3u8?key=a%2Bb')
  );
  const master = await GETTVBoxPlaylist(request(tvboxHlsUrl(origin, params)));
  const nested = new URL((await master.text()).split('\n')[2]);
  expect(nested.pathname).toBe(TVBOX_HLS_PATH);
  expect(nested.href).not.toMatch(/=http|rl=/);
  const childParams = tvboxHlsParams(nested.searchParams.get('id'));
  expect(childParams?.get('url')).toBe(
    'https://cdn.test/final/level.m3u8?key=a%2Bb'
  );
  expect(childParams?.get('token')).toBe('https-secret');
  const media = await GETTVBoxPlaylist(request(nested.href));
  expect(media.status).toBe(200);
  expect(await media.text()).not.toContain('/stream/hash/');
});

test('filters valid playlists with a generic binary MIME type, while rejecting actual binary content', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ...upstream(),
    headers: new Headers({ 'content-type': 'application/octet-stream' }),
  });
  expect(await (await get()).text()).not.toContain('/stream/hash/');
  (global.fetch as jest.Mock).mockResolvedValue({
    ...upstream('binary media'),
    headers: new Headers({ 'content-type': 'application/octet-stream' }),
  });
  expect((await get()).status).toBe(415);
});
