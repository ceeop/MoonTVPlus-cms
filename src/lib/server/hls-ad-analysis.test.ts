/** @jest-environment node */

import { filterUnmarkedHlsAds } from './hls-ad-analysis';
import { validateProxyUrlServerSide } from './ssrf';

jest.mock('./ssrf', () => ({ validateProxyUrlServerSide: jest.fn() }));
const groups = ['main0', 'main1', 'main2', 'insert0', 'insert1', 'main3'];
const content = [
  '#EXTM3U',
  ...groups.flatMap((name) => [
    '#EXT-X-DISCONTINUITY',
    `#EXTINF:${name.startsWith('insert') ? 5 : 20},`,
    `${name}.png`,
  ]),
  '#EXT-X-ENDLIST',
].join('\n');
const times: Record<string, number> = {
  main0: 1.4,
  main1: 21.4,
  main2: 41.4,
  insert0: 1.4,
  insert1: 6.4,
  main3: 61.4,
};
const originalFetch = global.fetch;
const cancel = jest.fn().mockResolvedValue(undefined);
function prefix(pts: number, level: number) {
  const packet = new Uint8Array(188).fill(255);
  const ticks = Math.round(pts * 90000);
  packet.set([
    0x47,
    0x41,
    0,
    0x10,
    0,
    0,
    1,
    0xe0,
    0,
    0,
    0x80,
    0x80,
    5,
    0x21 | ((Math.floor(ticks / 1073741824) & 7) << 1),
    Math.floor(ticks / 4194304) & 255,
    ((Math.floor(ticks / 32768) & 127) << 1) | 1,
    Math.floor(ticks / 128) & 255,
    ((ticks & 127) << 1) | 1,
    0,
    0,
    1,
    0x67,
    100,
    0,
    level,
    0xaa,
    0x80,
    0,
    0,
    1,
    0x68,
    0x80,
  ]);
  return packet;
}
beforeEach(() => {
  jest.clearAllMocks();
  (validateProxyUrlServerSide as jest.Mock).mockResolvedValue(true);
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    const name = new URL(url).pathname.split('/').pop()?.split('.')[0] || '';
    let read = false;
    return {
      ok: true,
      status: 206,
      body: {
        getReader: () => ({
          read: async () => {
            if (read) return { done: true };
            read = true;
            return {
              done: false,
              value: prefix(times[name], name.startsWith('insert') ? 50 : 40),
            };
          },
          cancel,
        }),
      },
    };
  });
});
afterAll(() => {
  global.fetch = originalFetch;
});

test.each([
  'https://one.example/playlist.m3u8',
  'https://another.example/config/list.txt',
])(
  'uses the same media evidence on any host or filename, preserving direct media links: %s',
  async (url) => {
    const [first, second] = await Promise.all([
      filterUnmarkedHlsAds(content, url),
      filterUnmarkedHlsAds(content, url),
    ]);
    expect(first).not.toContain('insert0.png');
    expect(first).not.toContain('insert1.png');
    expect(first).toContain('main3.png');
    expect(first).not.toContain('/api/proxy/');
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(cancel).toHaveBeenCalledTimes(6);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Range: 'bytes=0-16383' }),
        redirect: 'manual',
      })
    );
  }
);

test('failed probes preserve the text-filtered playlist and do not poison later retries', async () => {
  (fetch as jest.Mock).mockRejectedValue(new Error('unreachable'));
  const url = 'https://retry.example/file.m3u8';
  expect(await filterUnmarkedHlsAds(content, url)).toBe(content);
  expect(await filterUnmarkedHlsAds(content, url)).toBe(content);
  expect(fetch).toHaveBeenCalledTimes(12);
});

test('redirect targets receive network validation before any fetch', async () => {
  (validateProxyUrlServerSide as jest.Mock).mockImplementation(
    async (url: string) => !url.includes('127.0.0.1')
  );
  (fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status: 302,
    headers: { get: () => 'http://127.0.0.1/private' },
    body: { cancel },
  });
  expect(
    await filterUnmarkedHlsAds(content, 'https://redirect.example/a.m3u8')
  ).toBe(content);
  expect(
    (fetch as jest.Mock).mock.calls.every(([url]) => !url.includes('127.0.0.1'))
  ).toBe(true);
});

test('the analysis deadline returns a playable playlist and aborts outstanding media requests', async () => {
  jest.useFakeTimers();
  try {
    (fetch as jest.Mock).mockImplementation(() => new Promise(() => undefined));
    const result = filterUnmarkedHlsAds(content, 'https://slow.example/a.m3u8');
    for (let i = 0; i < 10 && !(fetch as jest.Mock).mock.calls.length; i++)
      await Promise.resolve();
    expect(fetch).toHaveBeenCalled();
    jest.advanceTimersByTime(10001);
    expect(await result).toBe(content);
    expect((fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
