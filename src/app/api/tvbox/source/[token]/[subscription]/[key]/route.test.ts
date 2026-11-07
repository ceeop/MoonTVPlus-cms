/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { getAvailableApiSites, getConfig } from '@/lib/config';
import { safeFetch } from '@/lib/safe-http';
import { authorizeTVBox } from '@/lib/tvbox/access';
import { TVBOX_HLS_PATH, tvboxHlsParams } from '@/lib/tvbox/hls';

import { GET } from './route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status || 200,
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  getAvailableApiSites: jest.fn(),
}));
jest.mock('@/lib/safe-http', () => ({ safeFetch: jest.fn() }));
jest.mock('@/lib/tvbox/access', () => ({
  authorizeTVBox: jest.fn(),
  TVBoxAccessError: class extends Error {},
  tvboxBaseUrl: () => 'http://192.168.1.10:3000',
}));

const document = {
  sites: [
    {
      key: 'cms',
      name: 'CMS',
      type: 1,
      api: 'https://example.test/cms?sourceToken=keep',
      header: { Referer: 'https://example.test/' },
    },
  ],
};
beforeEach(() => {
  jest.clearAllMocks();
  (authorizeTVBox as jest.Mock).mockResolvedValue({ global: true });
  (getAvailableApiSites as jest.Mock).mockResolvedValue([
    {
      key: 'cms',
      name: 'CMS',
      api: 'https://example.test/cms?sourceToken=keep',
    },
  ]);
  (getConfig as jest.Mock).mockResolvedValue({
    TVBoxConfig: {
      Subscriptions: [{ id: 'sample', enabled: true, document }],
      CatalogEnabled: true,
    },
  });
  (safeFetch as jest.Mock).mockResolvedValue({
    ok: true,
    text: async () =>
      JSON.stringify({
        page: 1,
        pagecount: 2,
        total: 40,
        list: [
          {
            vod_name: '普通电影',
            vod_play_url: '正片$https://video.test/a.m3u8',
          },
          { vod_name: '伦理片' },
        ],
      }),
  });
});
const get = (query: string, subscription = 'sample') =>
  GET(
    {
      nextUrl: new URL(
        `http://localhost/api/tvbox/source/token/${subscription}/cms?${query}`
      ),
    } as unknown as NextRequest,
    { params: { token: 'token', subscription, key: 'cms' } }
  );

test('forwards CMS paging and configured headers while applying the two requested filters', async () => {
  const response = await get('ac=detail&pg=2&adFilter=true&yellowFilter=true');
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.list).toHaveLength(1);
  const playback = new URL(data.list[0].vod_play_url.split('$')[1]);
  expect(playback.pathname).toBe(TVBOX_HLS_PATH);
  expect(tvboxHlsParams(playback.searchParams.get('id'))?.get('source')).toBe(
    'cms'
  );
  const [url, init] = (safeFetch as jest.Mock).mock.calls[0];
  const upstream = new URL(url);
  expect(upstream.searchParams.get('sourceToken')).toBe('keep');
  expect(upstream.searchParams.get('pg')).toBe('2');
  expect(upstream.searchParams.has('adFilter')).toBe(false);
  expect(init.headers.Referer).toBe('https://example.test/');
});

test('disabled or unselected sources are not contacted', async () => {
  (getConfig as jest.Mock).mockResolvedValue({
    TVBoxConfig: {
      Subscriptions: [
        { id: 'sample', enabled: true, selectedSiteKeys: [], document },
      ],
      CatalogEnabled: true,
    },
  });
  expect((await get('ac=detail')).status).toBe(404);
  expect(safeFetch).not.toHaveBeenCalled();
});

test('global M3U8 selection applies without ad blocking and cannot be disabled by subscription parameters', async () => {
  const config = await getConfig();
  (getConfig as jest.Mock).mockResolvedValue({
    ...config,
    SiteConfig: { M3u8Only: true },
  });
  (safeFetch as jest.Mock).mockResolvedValue({
    ok: true,
    text: async () =>
      JSON.stringify({
        list: [
          {
            vod_name: '电影',
            vod_play_from: 'web$$$hls',
            vod_play_url:
              '第4集$https://video.test/share$$$第4集$https://video.test/a.m3u8',
          },
        ],
      }),
  });
  const response = await get('ac=detail&m3u8Only=false&adFilter=false');
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.list[0].vod_play_from).toBe('hls');
  expect(data.list[0].vod_play_url).toBe('第4集$https://video.test/a.m3u8');
  expect(
    new URL((safeFetch as jest.Mock).mock.calls[0][0]).searchParams.has(
      'm3u8Only'
    )
  ).toBe(false);
});

test.each(['builtin', 'sample'])(
  'an already-loaded individual CMS URL follows the current policy on every request: %s',
  async (subscription) => {
    (safeFetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          list: [
            {
              vod_play_from: 'web$$$hls',
              vod_play_url:
                '第4集$https://video.test/share$$$第4集$https://video.test/a.m3u8',
            },
          ],
        }),
    });
    const config = await getConfig();
    const read = async () =>
      (await (await get('ac=detail&ids=4&adFilter=false', subscription)).json())
        .list[0];
    expect((await read()).vod_play_from).toBe('web$$$hls');
    (getConfig as jest.Mock).mockResolvedValue({
      ...config,
      SiteConfig: { M3u8Only: true },
    });
    expect(await read()).toMatchObject({
      vod_play_from: 'hls',
      vod_play_url: '第4集$https://video.test/a.m3u8',
    });
    (getConfig as jest.Mock).mockResolvedValue(config);
    expect((await read()).vod_play_from).toBe('web$$$hls');
  }
);

test('the built-in proxy cannot access a source outside the subscription token owner permissions', async () => {
  (authorizeTVBox as jest.Mock).mockResolvedValue({
    username: 'viewer',
    global: false,
  });
  (getAvailableApiSites as jest.Mock).mockResolvedValue([]);
  expect((await get('ac=detail&ids=4', 'builtin')).status).toBe(404);
  expect(getAvailableApiSites).toHaveBeenCalledWith('viewer');
  expect(safeFetch).not.toHaveBeenCalled();
});
