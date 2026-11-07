/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import Database from 'better-sqlite3';

import type { AdminConfig } from '@/lib/admin.types';
import { normalizeCmsItem } from '@/lib/catalog/model';
import { CatalogStore, getCatalogStore } from '@/lib/catalog/store';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { SQLiteAdapter } from '@/lib/d1-adapter';
import { db } from '@/lib/db';

import { tvboxCatalogContext } from './access';
import { tvboxCatalog } from './catalog';
import { TVBOX_HLS_PATH, tvboxHlsParams } from './hls';

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  getAvailableApiSites: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: { getUsernameByTvboxToken: jest.fn(), getUserInfoV2: jest.fn() },
}));
jest.mock('@/lib/catalog/store', () => ({
  ...jest.requireActual('@/lib/catalog/store'),
  getCatalogStore: jest.fn(),
}));

const a = { key: 'a', name: 'Source A', api: 'https://a.test/cms' };
const b = { key: 'b', name: 'Source B', api: 'https://b.test/cms' };
const raw = (values: Record<string, unknown> = {}) => ({
  vod_id: 'remote-1',
  vod_name: '测试电影',
  vod_year: '2026',
  type_id: '1',
  type_name: '电影',
  vod_pic: 'https://example.test/poster.jpg',
  vod_area: '中国大陆',
  vod_time: new Date().toISOString(),
  vod_play_from: 'web$$$hls',
  vod_play_url:
    '网页$https://video.test/watch$$$正片$https://video.test/a.m3u8?signature=keep',
  ...values,
});
let database: Database.Database;
let store: CatalogStore;
let config: AdminConfig;
let workId: string;
const initialEnvironment = { ...process.env };
afterAll(() => {
  process.env = initialEnvironment;
});
beforeEach(async () => {
  jest.clearAllMocks();
  process.env.ENABLE_TVBOX_SUBSCRIBE = 'true';
  process.env.TVBOX_SUBSCRIBE_TOKEN = 'global-test-token';
  delete process.env.TVBOX_BLOCKED_SOURCES;
  database = new Database(':memory:');
  store = new CatalogStore(new SQLiteAdapter(database));
  (getCatalogStore as jest.Mock).mockReturnValue(store);
  config = {
    CatalogConfig: {
      Enabled: true,
      SourceKeys: ['a', 'b'],
      IntervalMinutes: 30,
    },
    SourceConfig: [a, b],
    SiteConfig: { DisableYellowFilter: false },
  } as unknown as AdminConfig;
  (getConfig as jest.Mock).mockImplementation(async () => config);
  (getAvailableApiSites as jest.Mock).mockImplementation(
    async (username?: string) => (username ? [a] : [a, b])
  );
  (db.getUsernameByTvboxToken as jest.Mock).mockResolvedValue('viewer');
  (db.getUserInfoV2 as jest.Mock).mockResolvedValue({ banned: false });
  const item = normalizeCmsItem(raw(), a)!;
  workId = item.workId;
  await store.put(item, Date.now(), false);
  await store.put(
    normalizeCmsItem(raw({ vod_id: 'remote-b' }), b)!,
    Date.now(),
    false
  );
});
afterEach(() => database.close());
const query = (params = '', token = 'global-test-token') =>
  tvboxCatalog(token, new URLSearchParams(params), 'http://192.168.1.10:3000');

test('home provides deduplicated posters, categories, filters and token-authenticated image URLs', async () => {
  const result = await query();
  expect(result.total).toBe(1);
  expect(result.list).toHaveLength(1);
  expect(result.list[0]).toMatchObject({
    vod_id: workId,
    vod_name: '测试电影',
  });
  expect(result.list[0].vod_pic).toMatch(
    /^http:\/\/192\.168\.1\.10:3000\/api\/tvbox\/catalog\/global-test-token\/poster\/[a-f0-9]{64}$/
  );
  expect('class' in result && result.class).toEqual([
    { type_id: 'movie', type_name: '电影', type_pid: '0' },
  ]);
  expect((await query('wd=不存在')).total).toBe(0);
  expect((await query('t=movie&year=2026')).total).toBe(1);
  expect(
    (await query('f=' + encodeURIComponent(JSON.stringify({ year: '2025' }))))
      .total
  ).toBe(0);
});

test('details include direct media lines from all accessible sources and preserve signed URLs', async () => {
  const result = await query(`ac=detail&ids=${workId}`);
  expect(result.list).toHaveLength(1);
  const item = result.list[0] as {
    vod_play_from: string;
    vod_play_url: string;
  };
  expect(item.vod_play_from).toBe('Source A · hls$$$Source B · hls');
  expect(item.vod_play_url).toContain(
    'https://video.test/a.m3u8?signature=keep'
  );
  expect(item.vod_play_url).not.toContain('/watch');
  const filtered = await query(`ids=${workId}`, 'user-token');
  expect(filtered.list[0]).toMatchObject({ vod_play_from: 'Source A · hls' });
  expect((getAvailableApiSites as jest.Mock).mock.calls).toContainEqual([
    'viewer',
  ]);
  const proxied = await query(`ac=detail&ids=${workId}&adFilter=true`);
  const playUrls = (proxied.list[0] as { vod_play_url: string }).vod_play_url
    .split('$$$')
    .map((line) => new URL(line.slice(line.indexOf('$') + 1)));
  expect(
    playUrls.map((url) =>
      tvboxHlsParams(url.searchParams.get('id'))?.get('source')
    )
  ).toEqual(['a', 'b']);
  expect(playUrls.every((url) => url.pathname === TVBOX_HLS_PATH)).toBe(true);
});

test('disabled, banned and invalid tokens cannot read the catalog or its poster context', async () => {
  (db.getUsernameByTvboxToken as jest.Mock).mockResolvedValue(null);
  await expect(query('', 'invalid')).rejects.toMatchObject({ status: 401 });
  (db.getUsernameByTvboxToken as jest.Mock).mockResolvedValue('viewer');
  (db.getUserInfoV2 as jest.Mock).mockResolvedValue({ banned: true });
  await expect(tvboxCatalogContext('user-token')).rejects.toMatchObject({
    status: 403,
  });
  config.TVBoxConfig = { CatalogEnabled: false, Subscriptions: [] };
  await expect(query()).rejects.toMatchObject({ status: 404 });
  process.env.ENABLE_TVBOX_SUBSCRIBE = 'false';
  await expect(query()).rejects.toMatchObject({ status: 403 });
});

test('paged lists and searches use stable work IDs for subsequent detail requests', async () => {
  for (let index = 0; index < 31; index++)
    await store.put(
      normalizeCmsItem(
        raw({ vod_id: `more-${index}`, vod_name: `其他电影${index}` }),
        a
      )!,
      Date.now(),
      false
    );
  const first = await query('pg=1');
  const second = await query('pg=2');
  expect(first.total).toBe(32);
  expect(first.pagecount).toBe(2);
  expect(first.list).toHaveLength(30);
  expect(second.list).toHaveLength(2);
  expect(
    new Set([...first.list, ...second.list].map((item) => item.vod_id)).size
  ).toBe(32);
});

test('TVBox blocked sources are also excluded from aggregated playback lines', async () => {
  process.env.TVBOX_BLOCKED_SOURCES = ' b ';
  const result = await query(`ids=${workId}`);
  expect(result.list[0]).toMatchObject({ vod_play_from: 'Source A · hls' });
  expect((await tvboxCatalogContext('global-test-token')).sites).toEqual([a]);
});

test('catalog details follow the global format policy with the same subscription URL', async () => {
  config.SiteConfig.M3u8Only = true;
  await store.put(
    normalizeCmsItem(
      raw({
        vod_play_from: 'mp4$$$hls',
        vod_play_url:
          '文件$https://video.test/a.mp4$$$第四集$https://video.test/a.m3u8?signature=keep',
      }),
      a
    )!,
    Date.now(),
    false
  );
  const result = await query(`ac=detail&ids=${workId}&m3u8Only=false`);
  const item = result.list[0] as {
    vod_play_from: string;
    vod_play_url: string;
  };
  expect(item.vod_play_url).not.toContain('.mp4');
  expect(item.vod_play_url).not.toContain('/api/proxy-m3u8');
  expect(item.vod_play_url).toContain(
    '第四集$https://video.test/a.m3u8?signature=keep'
  );
  expect(item.vod_play_from).not.toContain('mp4');
  config.SiteConfig.M3u8Only = false;
  const all = await query(`ac=detail&ids=${workId}&m3u8Only=true`);
  expect((all.list[0] as { vod_play_url: string }).vod_play_url).toContain(
    '.mp4'
  );
});
