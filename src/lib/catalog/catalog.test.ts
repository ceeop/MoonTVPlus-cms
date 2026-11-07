/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import Database from 'better-sqlite3';

import type { AdminConfig } from '@/lib/admin.types';
import { SQLiteAdapter } from '@/lib/d1-adapter';

import {
  catalogCollectionDay,
  catalogItemEnabled,
  catalogRetentionCutoff,
  catalogScope,
  catalogSettings,
  cmsUrl,
  normalizeCmsItem,
  SyncState,
} from './model';
import { downloadCatalogPoster, POSTER_PREFIX } from './posters';
import { CatalogStore } from './store';

jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('./posters', () => ({
  ...jest.requireActual('./posters'),
  downloadCatalogPoster: jest.fn(),
}));
jest.mock('./store', () => {
  const actual = jest.requireActual('./store');
  return { ...actual, getCatalogStore: jest.fn() };
});

import { getConfig } from '@/lib/config';

import { collectCatalog } from './collector';
import { getCatalogStore } from './store';

const a = { key: 'a', name: '源 A', api: 'https://a.invalid/api?token=keep' };
const b = { key: 'b', name: '源 B', api: 'https://b.invalid/api' };
const raw = (overrides: Record<string, unknown> = {}) => ({
  vod_id: '1',
  vod_name: '三体 第一季',
  vod_year: '2023',
  type_id: '2',
  type_name: '国产剧',
  vod_area: '中国大陆',
  vod_pic: 'https://img.invalid/poster.jpg',
  vod_time: '2026-11-02 10:00:00',
  vod_play_from: 'hls',
  vod_play_url: '第1集$https://video.invalid/1.m3u8?token=abc',
  ...overrides,
});

let database: Database.Database;
let store: CatalogStore;
beforeEach(() => {
  jest.clearAllMocks();
  (downloadCatalogPoster as jest.Mock).mockResolvedValue({
    contentType: 'image/jpeg',
    data: '/9j/AA==',
  });
  global.fetch = jest.fn();
  database = new Database(':memory:');
  store = new CatalogStore(new SQLiteAdapter(database));
  (getCatalogStore as jest.Mock).mockReturnValue(store);
  (getConfig as jest.Mock).mockResolvedValue({
    CatalogConfig: {
      Enabled: true,
      SourceKeys: ['a', 'b'],
      IntervalMinutes: 30,
    },
    SourceConfig: [{ ...a }, { ...b }],
    SiteConfig: { DisableYellowFilter: false },
  } as unknown as AdminConfig);
});
afterEach(() => {
  database.close();
  jest.restoreAllMocks();
});

test('keeps signed playback URLs and all original lines', () => {
  const item = normalizeCmsItem(
    raw({
      vod_play_from: 'web$$$hls',
      vod_play_url:
        '正片$https://video.invalid/watch$$$第1集$https://video.invalid/a.m3u8?token=abc',
    }),
    a
  )!;
  expect(item.playLines).toHaveLength(2);
  expect(item.result.episodes).toEqual([
    'https://video.invalid/a.m3u8?token=abc',
  ]);
  expect(
    normalizeCmsItem(
      raw({ vod_play_url: '正片$https://video.invalid/watch' }),
      a
    )
  ).toBeNull();
});

test('groups matching works across sources and keeps seasons, years and unknown records apart', () => {
  const first = normalizeCmsItem(raw(), a)!;
  expect(normalizeCmsItem(raw(), b)!.workId).toBe(first.workId);
  for (const change of [
    { vod_name: '三体 第二季' },
    { vod_year: '2024' },
    { type_name: '科幻片' },
  ]) {
    expect(normalizeCmsItem(raw(change), b)!.workId).not.toBe(first.workId);
  }
  expect(normalizeCmsItem(raw({ vod_year: '' }), b)!.workId).not.toBe(
    normalizeCmsItem(raw({ vod_year: '' }), a)!.workId
  );
});

test('preserves authentication query parameters while replacing CMS filters', () => {
  const url = new URL(
    cmsUrl('https://a.invalid/api?token=secret&wd=old&h=24&pg=9', {
      ac: 'videolist',
      pg: 1,
    })
  );
  expect(url.searchParams.get('token')).toBe('secret');
  expect(url.searchParams.get('wd')).toBeNull();
  expect(url.searchParams.get('h')).toBeNull();
  expect(url.searchParams.get('pg')).toBe('1');
});

test('normalizes protocol-relative and escaped CMS poster URLs before indexing', () => {
  expect(
    normalizeCmsItem(
      raw({ vod_pic: '//img.invalid/poster?a=1&amp;amp;b=2' }),
      a
    )!.result.poster
  ).toBe('https://img.invalid/poster?a=1&b=2');
});

test('existing installs remain unchanged until the catalog is enabled', () => {
  expect(catalogSettings({}).Enabled).toBe(false);
});

test('Chinese title lookup uses indexed terms and returns original source IDs', async () => {
  await store.put(normalizeCmsItem(raw({ vod_id: '90071992547409930' }), a)!);
  await store.put(
    normalizeCmsItem(raw({ vod_id: '2', vod_name: '其他剧集' }), a)!
  );
  expect(
    (await store.search([a], { query: '三体' })).map((item) => item.id)
  ).toEqual(['90071992547409930']);
  expect(await store.search([a], { query: '体' })).toHaveLength(1);
  expect(await store.search([a], { query: '三季' })).toHaveLength(0);
  expect(await store.search([], { query: '三体' })).toHaveLength(0);
});

test('poster cards deduplicate works after applying source permissions', async () => {
  await store.put(normalizeCmsItem(raw(), a)!);
  await store.put(normalizeCmsItem(raw(), b)!);
  await store.put(
    normalizeCmsItem(raw({ vod_id: '2', vod_name: '隐藏的影片' }), b)!
  );
  const all = await store.browse([a, b]);
  expect(all.total).toBe(2);
  expect(
    all.results.find((item) => item.title === '三体 第一季')?.resource_count
  ).toBe(2);
  const permitted = await store.browse([a]);
  expect(permitted.total).toBe(1);
  expect(permitted.results[0].resource_count).toBe(1);
  expect(permitted.results[0].source).toBe('a');
  expect(
    await store.search([a], {
      workId: all.results.find((item) => item.title === '隐藏的影片')!.work_id,
    })
  ).toEqual([]);
});

test('folds existing split work IDs into one card and resolves each old detail link', async () => {
  const primary = normalizeCmsItem(raw({ vod_douban_id: 123 }), a)!;
  const fallback = normalizeCmsItem(raw(), b)!;
  const unknown = normalizeCmsItem(raw({ vod_id: '2', type_name: '热播' }), b)!;
  const items = [primary, fallback, unknown];
  for (const item of items) await store.put(item, Date.now(), false);
  expect(new Set(items.map((item) => item.workId)).size).toBe(3);

  const restarted = new CatalogStore(new SQLiteAdapter(database));
  const options = { query: '三体', defaultSourceKey: 'a', limit: 1 };
  const wall = await restarted.browse([a, b], options);
  expect(wall).toMatchObject({ total: 1, pageCount: 1 });
  expect(wall.results).toMatchObject([{ source: 'a', resource_count: 2 }]);
  expect(await restarted.browse([a, b], { ...options, page: 2 })).toMatchObject(
    {
      total: 1,
      results: [],
    }
  );
  for (const { workId } of items) {
    const links = await restarted.search([a, b], {
      workId,
      defaultSourceKey: 'a',
    });
    expect(links.map((item) => `${item.source}:${item.id}`)).toEqual([
      'a:1',
      'b:1',
      'b:2',
    ]);
  }
  expect((await restarted.browse([b], options)).results).toMatchObject([
    { source: 'b', resource_count: 1 },
  ]);
  expect(
    (await restarted.search([b], { workId: fallback.workId })).map(
      (item) => item.id
    )
  ).toEqual(['1', '2']);
  expect((await restarted.detail(b, '2'))?.id).toBe('2');
});

test('keeps conflicting Douban IDs, release years, types and editions apart', async () => {
  const first = normalizeCmsItem(raw({ vod_douban_id: 123 }), a)!;
  const second = normalizeCmsItem(raw({ vod_id: '2', vod_douban_id: 456 }), b)!;
  const fallback = normalizeCmsItem(raw(), b)!;
  const separate = [
    { vod_year: '2024' },
    { vod_year: '' },
    { type_name: '电影' },
    { vod_name: '三体 第二季' },
    { vod_name: '三体 第一季 粤语版' },
  ].map(
    (fields, index) =>
      normalizeCmsItem(raw({ ...fields, vod_id: `extra-${index}` }), a)!
  );
  const items = [first, second, fallback, ...separate];
  for (const item of items) await store.put(item, Date.now(), false);
  expect((await store.browse([a, b])).total).toBe(items.length);
  for (const item of items) {
    const details = await store.search([a, b], { workId: item.workId });
    expect(details).toMatchObject([
      { id: item.result.id, source: item.result.source },
    ]);
  }
});

test('default source wins cards and detail ordering even over a newer resource with a cached poster', async () => {
  const primary = normalizeCmsItem(
    raw({
      vod_pic: 'https://img.invalid/primary.jpg',
      vod_content: '默认源简介',
    }),
    b
  )!;
  const newer = normalizeCmsItem(
    raw({ vod_time: '2026-11-03 10:00:00', vod_content: '其他源简介' }),
    a
  )!;
  await store.put(primary, Date.now(), false);
  await store.put(newer);
  const options = { defaultSourceKey: 'b' };
  const card = (await store.browse([a, b], options)).results[0];
  expect(card.source).toBe('b');
  expect(card.desc).toBe('默认源简介');
  expect(card.poster).not.toBe((await store.detail(a, '1'))?.poster);
  expect(
    (await store.search([a, b], { ...options, workId: primary.workId }))[0]
      .source
  ).toBe('b');
  expect((await store.browse([a], options)).results[0].source).toBe('a');
  expect(
    (await store.browse([a, b], { defaultSourceKey: 'a' })).results[0].source
  ).toBe('a');
});

test('collector starts with the default source and continues other sources after its failure', async () => {
  const config = await getConfig();
  config.CatalogConfig!.DefaultSourceKey = 'b';
  const calls: string[] = [];
  global.fetch = jest.fn().mockImplementation(async (url) => {
    calls.push(new URL(url).hostname);
    if (new URL(url).hostname === 'b.invalid') throw new Error('offline');
    return {
      ok: true,
      text: async () => JSON.stringify({ list: [], pagecount: 1 }),
    };
  });
  await collectCatalog();
  expect(calls).toEqual(['b.invalid', 'a.invalid']);
});

test('filters and pagination operate on works, not duplicate resources', async () => {
  for (let i = 1; i <= 4; i++)
    await store.put(
      normalizeCmsItem(
        raw({
          vod_id: i,
          vod_name: `影片${i}`,
          type_name: '科幻片',
          vod_year: '2025',
        }),
        a
      )!
    );
  await store.put(normalizeCmsItem(raw({ vod_id: '99' }), a)!);
  const result = await store.browse([a], {
    kind: 'movie',
    year: '2025',
    page: 2,
    limit: 2,
  });
  expect(result.total).toBe(4);
  expect(result.results).toHaveLength(2);
  expect(result.pageCount).toBe(2);
});

test('poster cards default to newest release years while retaining explicit update ordering', async () => {
  for (const data of [
    { vod_id: 'old', vod_year: '2010', vod_time: '2026-11-04 10:00:00' },
    { vod_id: 'new', vod_year: '2026', vod_time: '2026-11-01 10:00:00' },
    { vod_id: 'unknown', vod_year: '', vod_time: '2026-11-05 10:00:00' },
  ]) {
    await store.put(normalizeCmsItem(raw(data), a)!, Date.now(), false);
  }
  const releaseOrder = ['new', 'old', 'unknown'];
  for (const order of [undefined, '', 'year']) {
    expect(
      (await store.browse([a], { order })).results.map((card) => card.id)
    ).toEqual(releaseOrder);
  }
  expect(
    (await store.browse([a], { limit: 1, page: 2 })).results.map(
      (card) => card.id
    )
  ).toEqual(['old']);
  expect(
    (await store.browse([a], { order: 'updated' })).results.map(
      (card) => card.id
    )
  ).toEqual(['unknown', 'old', 'new']);
});

test('paged cards keep permitted update order and resource counts across detail batches', async () => {
  for (let index = 0; index < 65; index++) {
    const item = normalizeCmsItem(
      raw({ vod_id: index, vod_name: `作品${index}` }),
      a
    )!;
    item.updatedAt = 1000 + index;
    await store.put(item, Date.now(), false);
    const hidden = normalizeCmsItem(
      raw({ vod_id: index, vod_name: `作品${index}` }),
      b
    )!;
    hidden.updatedAt = 100000 - index;
    await store.put(hidden, Date.now(), false);
  }
  const result = await store.browse([a], { order: 'updated', limit: 60 });
  expect(result.total).toBe(65);
  expect(result.pageCount).toBe(2);
  expect(result.results.map((card) => card.id)).toEqual(
    Array.from({ length: 60 }, (_, index) => String(64 - index))
  );
  expect(
    result.results.every(
      (card) => card.resource_count === 1 && card.source === 'a'
    )
  ).toBe(true);
  const next = await store.browse([a], {
    order: 'updated',
    limit: 60,
    page: 2,
  });
  expect(next.results.map((card) => card.id)).toEqual([
    '4',
    '3',
    '2',
    '1',
    '0',
  ]);
});

test('details survive a store restart and apply current source configuration', async () => {
  await store.put(normalizeCmsItem(raw(), a)!);
  const restarted = new CatalogStore(new SQLiteAdapter(database));
  const detail = await restarted.detail(
    { ...a, name: '新名称', proxyMode: true },
    '1'
  );
  expect(detail?.source_name).toBe('新名称');
  expect(detail?.proxyMode).toBe(true);
});

test('long title queries and 40 permitted sources stay within D1 parameter limits', async () => {
  let maximum = 0;
  const adapter = new SQLiteAdapter(database);
  const prepare = adapter.prepare.bind(adapter);
  adapter.prepare = (sql) => {
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: Array<string | number>) => {
      maximum = Math.max(maximum, values.length);
      return bind(...values);
    };
    return statement;
  };
  const tracked = new CatalogStore(adapter);
  const title = Array.from({ length: 40 }, (_, index) =>
    String.fromCharCode(0x4e00 + index)
  ).join('');
  for (let index = 0; index < 31; index++) {
    await tracked.put(
      normalizeCmsItem(raw({ vod_id: index, vod_name: title + index }), a)!,
      Date.now(),
      false
    );
  }
  const sites = [
    a,
    ...Array.from({ length: 39 }, (_, index) => ({
      ...b,
      key: `other_${index}`,
    })),
  ];
  const result = await tracked.browse(sites, { query: title, limit: 60 });
  expect(result.results).toHaveLength(31);
  expect(maximum).toBeLessThanOrEqual(100);
});

test('changing a source API hides resources collected from its previous endpoint', async () => {
  await store.put(normalizeCmsItem(raw(), a)!);
  const changed = { ...a, api: 'https://replacement.invalid/api' };
  expect(await store.detail(changed, '1')).toBeNull();
  expect(await store.search([changed], { query: '三体' })).toEqual([]);
  expect((await store.browse([changed])).total).toBe(0);
});

test('category filtering applies to both poster counts and search results', async () => {
  await store.put(normalizeCmsItem(raw(), a)!);
  await store.put(
    normalizeCmsItem(
      raw({ vod_id: '2', vod_name: '过滤影片', type_name: '伦理片' }),
      a
    )!
  );
  expect((await store.browse([a])).total).toBe(2);
  expect((await store.browse([a], { excludeRestricted: true })).total).toBe(1);
  expect(
    await store.search([a], { query: '过滤', excludeRestricted: true })
  ).toEqual([]);
});

test('durable lease prevents duplicate collectors and stale workers cannot release it', async () => {
  const state: SyncState = {
    fingerprint: 'test',
    nextPage: 1,
    totalPages: 1,
    fullDone: false,
    lastSuccess: 0,
    startedAt: Date.now(),
    windowHours: 0,
    action: 'full',
    error: '',
    retryAt: 0,
  };
  expect(await store.acquire('a', 'first', state, Date.now())).toEqual(state);
  expect(await store.acquire('a', 'second', state, Date.now())).toBeNull();
  await store.release('a', 'second');
  expect(await store.acquire('a', 'third', state, Date.now())).toBeNull();
  await store.release('a', 'first');
  expect(await store.acquire('a', 'third', state, Date.now())).toEqual(state);
});

function mockSource(pages: number, failPage = 0) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    const page = Number(new URL(String(url)).searchParams.get('pg'));
    if (page === failPage) return { ok: false, status: 503 } as Response;
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          code: 1,
          pagecount: pages,
          list: [
            raw({
              vod_id: String(page),
              vod_name: `三体${page}`,
              vod_time: new Date(Date.now()).toISOString(),
            }),
          ],
        }),
    } as Response;
  });
}

test('daily update collection checkpoints pages and continues after interruption', async () => {
  const fetchMock = mockSource(5, 2);
  await collectCatalog({ source: 'a' });
  let state = (await store.states())[0];
  expect(state.state.nextPage).toBe(2);
  expect(state.state.error).toContain('503');
  expect(state.count).toBe(1);
  fetchMock.mockRestore();
  mockSource(5);
  await collectCatalog({ source: 'a', force: true });
  state = (await store.states())[0];
  expect(state.state.nextPage).toBe(5);
  expect(state.state.fullDone).toBe(false);
  expect(state.count).toBe(4);
  await collectCatalog({ source: 'a', force: true });
  state = (await store.states())[0];
  expect(state.state.fullDone).toBe(true);
  expect(state.state.nextPage).toBe(1);
  expect(state.running).toBe(false);
  expect(state.count).toBe(5);
});

test('collects CMS API sources that also configure a detail website', async () => {
  const config = await getConfig();
  (getConfig as jest.Mock).mockResolvedValue({
    ...config,
    SourceConfig: [{ ...a, detail: 'https://a.invalid/' }],
  });
  const fetchMock = mockSource(1);

  const result = await collectCatalog({ source: 'a' });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/api');
  expect(result.processed).toBe(1);
  expect((await store.states())[0].count).toBe(1);
});

test('daily update collection uses a bounded hour window and respects the interval', async () => {
  const now = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-11-05T04:30:00Z'));
  const fetchMock = mockSource(1);
  await collectCatalog({ source: 'a' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await collectCatalog({ source: 'a' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockImplementation(
    async () =>
      ({
        ok: true,
        text: async () =>
          JSON.stringify({
            code: 1,
            pagecount: 1,
            list: [
              raw({
                vod_id: '2',
                vod_name: '最新更新',
                vod_time: '2026-11-05 13:00:00',
              }),
            ],
          }),
      } as Response)
  );
  now.mockReturnValue(Date.parse('2026-11-05T05:01:00Z'));
  await collectCatalog({ source: 'a' });
  expect(
    Number(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('h'))
  ).toBe(14);
  expect(
    new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('pg')
  ).toBe('1');
  expect(await store.search([a])).toHaveLength(2);
});

test('daily collection uses China midnight and ignores updates outside that day', async () => {
  const now = Date.parse('2026-11-05T04:30:00Z');
  jest.spyOn(Date, 'now').mockReturnValue(now);
  expect(catalogCollectionDay(now)).toEqual({
    start: Date.parse('2026-11-04T16:00:00Z'),
    end: Date.parse('2026-11-05T16:00:00Z'),
  });
  const fetchMock = jest
    .spyOn(global, 'fetch')
    .mockImplementation(async (url) => {
      const page = Number(new URL(String(url)).searchParams.get('pg'));
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            code: 1,
            pagecount: 3518,
            list:
              page === 1
                ? [
                    raw({
                      vod_id: 'today',
                      vod_year: '1980',
                      vod_time: '2026-11-05 12:00:00',
                    }),
                    raw({
                      vod_id: 'midnight',
                      vod_time: '2026-11-05 00:00:00',
                    }),
                    raw({
                      vod_id: 'yesterday',
                      vod_time: '2026-11-04 23:59:59',
                    }),
                    raw({
                      vod_id: 'tomorrow',
                      vod_time: '2026-11-06 00:00:00',
                    }),
                  ]
                : [raw({ vod_id: 'older', vod_time: '2026-11-04 12:00:00' })],
          }),
      } as Response;
    });
  await collectCatalog({ source: 'a' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [url] of fetchMock.mock.calls) {
    expect(new URL(String(url)).searchParams.get('h')).toBe('13');
  }
  expect((await store.search([a])).map((item) => item.id).sort()).toEqual([
    'midnight',
    'today',
  ]);
  const state = (await store.states())[0].state;
  expect(state.fullDone).toBe(true);
  expect(state.nextPage).toBe(1);
});

test('a new China calendar day restarts pending update pagination at page one', async () => {
  const now = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-11-05T15:59:00Z'));
  const fetchMock = mockSource(5);
  await collectCatalog({ source: 'a' });
  expect((await store.states())[0].state.nextPage).toBe(4);
  now.mockReturnValue(Date.parse('2026-11-05T16:01:00Z'));
  await collectCatalog({ source: 'a' });
  expect(
    fetchMock.mock.calls.map(([url]) => {
      const params = new URL(String(url)).searchParams;
      return [params.get('pg'), params.get('h')];
    })
  ).toEqual([
    ['1', '24'],
    ['2', '24'],
    ['3', '24'],
    ['1', '1'],
    ['2', '1'],
    ['3', '1'],
  ]);
});

test('existing history checkpoints restart with the daily update window immediately', async () => {
  const now = Date.parse('2026-11-05T04:30:00Z');
  jest.spyOn(Date, 'now').mockReturnValue(now);
  await store.acquire(
    'a',
    'legacy',
    {
      fingerprint: 'legacy',
      nextPage: 9,
      totalPages: 3518,
      fullDone: false,
      lastSuccess: 0,
      startedAt: now - 86400000,
      windowHours: 0,
      action: 'full',
      error: '',
      retryAt: now + 300000,
    },
    now
  );
  await store.release('a', 'legacy');
  const fetchMock = mockSource(1);
  await collectCatalog({ source: 'a' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const params = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
  expect(params.get('pg')).toBe('1');
  expect(params.get('h')).toBe('13');
  expect((await store.states())[0].state.action).toBe('incremental');
});

test('an empty first update page completes the daily check', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({ code: 1, pagecount: 3518, list: [] }),
  });
  await collectCatalog({ source: 'a' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const state = (await store.states())[0].state;
  expect(state.fullDone).toBe(true);
  expect(state.error).toBe('');
  expect(state.nextPage).toBe(1);
});

test('missing update timestamps keep the daily checkpoint for retry', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: async () =>
      JSON.stringify({
        code: 1,
        pagecount: 3518,
        list: [raw({ vod_time: '' })],
      }),
  });
  await collectCatalog({ source: 'a' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const entry = (await store.states())[0];
  expect(entry.state.error).toContain('有效更新时间');
  expect(entry.state.nextPage).toBe(1);
  expect(entry.count).toBe(0);
});

test('restarting daily collection resets once and continues within the same batch', async () => {
  const fetchMock = mockSource(5);
  await collectCatalog({ source: 'a', force: true, reset: true });
  expect(
    fetchMock.mock.calls.map(([url]) =>
      new URL(String(url)).searchParams.get('pg')
    )
  ).toEqual(['1', '2', '3']);
  expect((await store.states())[0].state.nextPage).toBe(4);
});

test('legacy settings keep every kind while an explicit empty selection stays empty', () => {
  expect(catalogSettings({}).Kinds).toEqual([
    'movie',
    'tv',
    'anime',
    'variety',
    'other',
  ]);
  expect(
    catalogSettings({
      CatalogConfig: {
        Enabled: true,
        SourceKeys: ['a'],
        IntervalMinutes: 30,
        Kinds: [],
      },
    }).Kinds
  ).toEqual([]);
});

test('all ingestion paths can share the source, kind and restricted-content policy', async () => {
  const config = await getConfig();
  config.CatalogConfig!.Kinds = ['movie'];
  expect(catalogItemEnabled(config, normalizeCmsItem(raw(), a)!)).toBe(false);
  expect(
    catalogItemEnabled(
      config,
      normalizeCmsItem(raw({ type_name: '科幻片' }), a)!
    )
  ).toBe(true);
  expect(
    catalogItemEnabled(
      config,
      normalizeCmsItem(raw({ type_name: '伦理片' }), a)!
    )
  ).toBe(false);
  expect(
    catalogItemEnabled(
      config,
      normalizeCmsItem(raw({ type_name: '科幻片' }), { ...a, key: 'unknown' })!
    )
  ).toBe(false);
  config.SourceConfig[0].disabled = true;
  expect(
    catalogItemEnabled(
      config,
      normalizeCmsItem(raw({ type_name: '科幻片' }), a)!
    )
  ).toBe(false);
});

test('changing collected kinds restarts pagination and only indexes matching resources', async () => {
  const config = await getConfig();
  config.CatalogConfig!.Kinds = ['movie'];
  const fetchMock = mockSource(1);
  await collectCatalog({ source: 'a' });
  expect(await store.search([a])).toHaveLength(0);
  config.CatalogConfig!.Kinds = ['tv'];
  await collectCatalog({ source: 'a' });
  expect(await store.search([a])).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(
    Number(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('h'))
  ).toBeGreaterThanOrEqual(1);
});

test('kind selection applies to search, details, category lists and wall facets', async () => {
  await store.put(normalizeCmsItem(raw(), a)!);
  await store.put(
    normalizeCmsItem(
      raw({
        vod_id: '2',
        type_id: '1',
        type_name: '科幻片',
        vod_year: '1980',
        vod_area: '美国',
      }),
      a
    )!
  );
  expect(await store.search([a], { kinds: ['movie'] })).toHaveLength(1);
  expect(await store.detail(a, '1', { kinds: ['movie'] })).toBeNull();
  expect(await store.categories(a, { kinds: ['movie'] })).toEqual([
    { type_id: '1', type_name: '科幻片' },
  ]);
  const wall = await store.browse([a], { kinds: ['movie'] });
  expect(wall.total).toBe(1);
  expect(wall.years).toEqual(['1980']);
  expect(wall.areas).toEqual(['美国']);
  expect((await store.browse([a], { kinds: [] })).total).toBe(0);
});

test('six-month cutoff clamps month ends and preserves the time of day', () => {
  expect(
    new Date(
      catalogRetentionCutoff(Date.parse('2026-08-31T12:34:56Z'))
    ).toISOString()
  ).toBe('2026-02-28T12:34:56.000Z');
  expect(
    new Date(
      catalogRetentionCutoff(Date.parse('2024-08-31T12:34:56Z'))
    ).toISOString()
  ).toBe('2024-02-29T12:34:56.000Z');
  expect(
    new Date(
      catalogRetentionCutoff(Date.parse('2026-01-31T12:34:56Z'))
    ).toISOString()
  ).toBe('2025-07-31T12:34:56.000Z');
});

test('retention defaults remain enabled for six months and custom periods use calendar months', () => {
  expect(catalogSettings({})).toEqual(
    expect.objectContaining({ CleanupEnabled: true, RetentionMonths: 6 })
  );
  expect(
    new Date(
      catalogRetentionCutoff(Date.parse('2026-03-31T12:34:56Z'), 1)
    ).toISOString()
  ).toBe('2026-02-28T12:34:56.000Z');
  expect(
    new Date(
      catalogRetentionCutoff(Date.parse('2026-03-31T12:34:56Z'), 12)
    ).toISOString()
  ).toBe('2025-03-31T12:34:56.000Z');
  for (const RetentionMonths of [0, -1, 1.5, 121, NaN, Infinity]) {
    expect(
      catalogSettings({
        CatalogConfig: { ...catalogSettings({}), RetentionMonths },
      }).RetentionMonths
    ).toBe(6);
  }
});

test('retention settings apply consistently to browsing, facets, search, details and posters', async () => {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  for (const [months, year] of [
    [13, '1980'],
    [9, '1990'],
    [4, '2000'],
    [1, '2026'],
  ] as const) {
    await store.put(
      normalizeCmsItem(raw({ vod_id: String(months), vod_year: year }), a)!,
      catalogRetentionCutoff(now, months)
    );
  }
  const settings = catalogSettings({});
  const defaults = catalogScope(settings);
  expect((await store.browse([a], defaults)).years).toEqual(['2026', '2000']);
  settings.RetentionMonths = 12;
  const longer = catalogScope(settings);
  const wall = await store.browse([a], longer);
  expect(wall.total).toBe(3);
  expect(wall.years).toEqual(['2026', '2000', '1990']);
  expect(await store.search([a], longer)).toHaveLength(3);
  const detail = await store.detail(a, '9', longer);
  expect(detail).not.toBeNull();
  expect(
    await store.poster(detail!.poster.slice(POSTER_PREFIX.length), [a], longer)
  ).not.toBeNull();
  settings.CleanupEnabled = false;
  const disabled = catalogScope(settings);
  expect((await store.browse([a], disabled)).years).toEqual([
    '2026',
    '2000',
    '1990',
    '1980',
  ]);
  expect(await store.search([a], disabled)).toHaveLength(4);
  expect(await store.detail(a, '13', disabled)).not.toBeNull();
  const cleanup = await store.cleanupExpired(now, true, 3);
  expect(cleanup?.resources).toBe(3);
  expect(await store.search([a], disabled)).toHaveLength(1);
});

test('scheduled cleanup honors its own switch and configured retention period', async () => {
  const config = await getConfig();
  config.CatalogConfig = {
    ...config.CatalogConfig!,
    Enabled: false,
    CleanupEnabled: false,
    RetentionMonths: 3,
  };
  await store.put(
    normalizeCmsItem(raw(), a)!,
    catalogRetentionCutoff(Date.now(), 4)
  );
  await collectCatalog();
  expect(await store.cleanupStatus()).toBeNull();
  expect(
    database.prepare('SELECT COUNT(*) AS n FROM catalog_resources').get()
  ).toEqual({ n: 1 });
  config.CatalogConfig.CleanupEnabled = true;
  await collectCatalog();
  expect((await store.cleanupStatus())?.resources).toBe(1);
  expect(
    database.prepare('SELECT COUNT(*) AS n FROM catalog_resources').get()
  ).toEqual({ n: 0 });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('retention removes only expired resources, orphan works, indexes and unshared posters', async () => {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  const cutoff = catalogRetentionCutoff(now);
  await store.put(normalizeCmsItem(raw(), a)!, cutoff - 1);
  await store.put(normalizeCmsItem(raw(), b)!, now);
  await store.put(
    normalizeCmsItem(
      raw({
        vod_id: '2',
        vod_name: '独立过期作品',
        vod_pic: 'https://img.invalid/old.jpg',
      }),
      a
    )!,
    cutoff - 1
  );
  await store.put(
    normalizeCmsItem(raw({ vod_id: '3', vod_name: '边界作品' }), a)!,
    cutoff
  );
  await store.put(
    normalizeCmsItem(
      raw({
        vod_id: '4',
        vod_name: '经典老片',
        vod_year: '1980',
        vod_time: '1980-01-01',
      }),
      a
    )!,
    now
  );
  database.exec(
    "CREATE TABLE test_favorites (id TEXT); INSERT INTO test_favorites VALUES ('keep'); CREATE TABLE test_play_records (id TEXT); INSERT INTO test_play_records VALUES ('keep')"
  );
  // Expired data is hidden even before a scheduled cleanup has run.
  expect(await store.detail(a, '1')).toBeNull();
  const result = await store.cleanupExpired(now);
  expect(result).toEqual({ lastRun: now, resources: 2, works: 1, posters: 1 });
  expect(await store.detail(b, '1')).not.toBeNull();
  expect(await store.detail(a, '3')).not.toBeNull();
  expect(await store.detail(a, '4')).not.toBeNull();
  expect(
    database
      .prepare(
        'SELECT COUNT(*) AS n FROM catalog_terms WHERE work_id NOT IN (SELECT id FROM catalog_works)'
      )
      .get()
  ).toEqual({ n: 0 });
  expect(
    database.prepare('SELECT COUNT(*) AS n FROM catalog_posters').get()
  ).toEqual({ n: 1 });
  expect(database.prepare('SELECT * FROM test_favorites').all()).toEqual([
    { id: 'keep' },
  ]);
  expect(database.prepare('SELECT * FROM test_play_records').all()).toEqual([
    { id: 'keep' },
  ]);
});

test('daily cleanup schedule and lease survive restart and allow an explicit manual run', async () => {
  const now = Date.now();
  const restarted = new CatalogStore(new SQLiteAdapter(database));
  const runs = await Promise.all([
    store.cleanupExpired(now),
    restarted.cleanupExpired(now),
  ]);
  expect(runs.filter(Boolean)).toHaveLength(1);
  expect(await restarted.cleanupExpired(now + 3600000)).toBeNull();
  expect(await restarted.cleanupStatus()).toEqual(runs.find(Boolean));
  expect(await restarted.cleanupExpired(now + 3600000, true)).not.toBeNull();
  expect(await restarted.cleanupExpired(now + 2 * 86400000)).not.toBeNull();
});

test('turning collection off still runs retention without fetching sources', async () => {
  await store.put(normalizeCmsItem(raw(), a)!, catalogRetentionCutoff() - 1);
  const config = await getConfig();
  config.CatalogConfig!.Enabled = false;
  await collectCatalog();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(
    database.prepare('SELECT COUNT(*) AS n FROM catalog_resources').get()
  ).toEqual({ n: 0 });
});

test('posters persist across restart, deduplicate URLs and obey source and kind permissions', async () => {
  await store.put(normalizeCmsItem(raw(), a)!);
  await store.put(normalizeCmsItem(raw(), b)!);
  expect(downloadCatalogPoster).toHaveBeenCalledTimes(1);
  const restarted = new CatalogStore(new SQLiteAdapter(database));
  const detail = await restarted.detail(a, '1');
  expect(detail!.poster).toMatch(/^\/api\/catalog\/posters\/[a-f0-9]{64}$/);
  const id = detail!.poster.slice(POSTER_PREFIX.length);
  expect((await restarted.poster(id, [a]))?.data).toEqual(
    Buffer.from('/9j/AA==', 'base64')
  );
  expect(await restarted.poster(id, [])).toBeNull();
  expect(
    await restarted.poster(id, [{ ...a, api: 'https://changed.invalid' }])
  ).toBeNull();
  expect(await restarted.poster(id, [a], { kinds: ['movie'] })).toBeNull();
  expect(await restarted.poster('../bad', [a])).toBeNull();
});

test('a permitted image request fills the local cache before the background queue reaches it', async () => {
  const item = normalizeCmsItem(raw(), a)!;
  const result = await store.put(item, Date.now(), false);
  const id = result.poster.slice(POSTER_PREFIX.length);
  expect(downloadCatalogPoster).not.toHaveBeenCalled();
  expect(await store.poster(id, [b])).toBeNull();
  expect(downloadCatalogPoster).not.toHaveBeenCalled();
  expect((await store.poster(id, [a]))?.contentType).toBe('image/jpeg');
  expect(downloadCatalogPoster).toHaveBeenCalledTimes(1);
  await store.poster(id, [a]);
  expect(downloadCatalogPoster).toHaveBeenCalledTimes(1);
  expect(item.result.poster).toBe('https://img.invalid/poster.jpg');
});

test('uses a saved alternate poster for the same work without downloading from a failed host', async () => {
  const primary = await store.put(
    normalizeCmsItem(raw(), a)!,
    Date.now(),
    false
  );
  await store.put(
    normalizeCmsItem(raw({ vod_pic: 'https://img.invalid/backup.jpg' }), b)!
  );
  (downloadCatalogPoster as jest.Mock).mockClear().mockResolvedValue(null);
  const id = primary.poster.slice(POSTER_PREFIX.length);
  expect((await store.poster(id, [a, b]))?.data).toEqual(
    Buffer.from('/9j/AA==', 'base64')
  );
  expect(downloadCatalogPoster).not.toHaveBeenCalled();
  // A viewer without access to the backup resource may not receive its poster.
  expect(await store.poster(id, [a])).toBeNull();
  expect(downloadCatalogPoster).toHaveBeenCalledTimes(1);
  expect((await store.browse([a, b])).results[0].source).toBe('b');
});

test('downloads a permitted alternate poster when the preferred origin fails', async () => {
  const primary = await store.put(
    normalizeCmsItem(raw(), a)!,
    Date.now(),
    false
  );
  await store.put(
    normalizeCmsItem(raw({ vod_pic: 'https://img.invalid/backup.jpg' }), b)!,
    Date.now(),
    false
  );
  (downloadCatalogPoster as jest.Mock).mockImplementation(async (url) =>
    url.endsWith('backup.jpg')
      ? { contentType: 'image/jpeg', data: '/9j/AA==' }
      : null
  );
  expect(
    (await store.poster(primary.poster.slice(POSTER_PREFIX.length), [a, b]))
      ?.contentType
  ).toBe('image/jpeg');
  expect(await store.rows('SELECT id FROM catalog_posters')).toHaveLength(1);
});

test('concurrent requests for an uncached image share one download', async () => {
  const primary = await store.put(
    normalizeCmsItem(raw(), a)!,
    Date.now(),
    false
  );
  const id = primary.poster.slice(POSTER_PREFIX.length);
  const results = await Promise.all([
    store.poster(id, [a]),
    store.poster(id, [a]),
  ]);
  expect(results.every(Boolean)).toBe(true);
  expect(downloadCatalogPoster).toHaveBeenCalledTimes(1);
});

test('poster backfill converts legacy URLs without renewing the resource retention clock', async () => {
  const indexedAt = Date.now() - 86400000;
  const item = normalizeCmsItem(raw(), a)!;
  await store.put(item, indexedAt, false);
  const payload = JSON.parse(
    String(
      (await store.rows('SELECT payload FROM catalog_resources'))[0].payload
    )
  );
  payload.poster = 'https://img.invalid/poster.jpg';
  delete payload.catalog_poster_origin;
  database
    .prepare('UPDATE catalog_resources SET payload=?')
    .run(JSON.stringify(payload));
  await store.backfillPosters();
  expect((await store.detail(a, '1'))!.poster).toMatch(
    /^\/api\/catalog\/posters\//
  );
  expect(
    (await store.rows('SELECT indexed_at FROM catalog_resources'))[0].indexed_at
  ).toBe(indexedAt);
});

test('failed poster downloads do not block collection or starve the rest of the image queue', async () => {
  (downloadCatalogPoster as jest.Mock).mockResolvedValue(null);
  for (let id = 1; id <= 4; id++)
    await store.put(
      normalizeCmsItem(
        raw({ vod_id: id, vod_pic: `https://img.invalid/${id}.jpg` }),
        a
      )!,
      Date.now() + id,
      false
    );
  await store.backfillPosters();
  expect(downloadCatalogPoster).toHaveBeenCalledTimes(3);
  (downloadCatalogPoster as jest.Mock).mockResolvedValue({
    contentType: 'image/jpeg',
    data: '/9j/AA==',
  });
  await store.backfillPosters();
  expect(downloadCatalogPoster).toHaveBeenCalledTimes(4);
  expect(await store.rows('SELECT id FROM catalog_posters')).toHaveLength(1);
});

test('global M3U8 catalog filtering keeps totals and pages accurate without deleting full stored lines', async () => {
  const db = new Database(':memory:');
  const catalog = new CatalogStore(new SQLiteAdapter(db));
  try {
    const files = normalizeCmsItem(
      raw({
        vod_id: 'format-file',
        vod_name: '文件独有',
        vod_play_from: 'file',
        vod_play_url: '文件$https://video.test/a.mp4',
      }),
      a
    )!;
    const mixed = normalizeCmsItem(
      raw({
        vod_id: 'format-mixed',
        vod_name: '混合线路',
        vod_play_from: 'file$$$hls',
        vod_play_url:
          '文件$https://video.test/a.mp4$$$第四集$https://video.test/a.M3U8?sign=keep',
      }),
      a
    )!;
    const hls = normalizeCmsItem(
      raw({
        vod_id: 'format-hls',
        vod_name: '纯直链',
        vod_play_from: 'hls',
        vod_play_url: '正片$https://video.test/b.m3u8',
      }),
      a
    )!;
    for (const item of [files, mixed, hls])
      await catalog.put(item, Date.now(), false);
    const first = await catalog.browse([a], { m3u8Only: true, limit: 1 });
    const second = await catalog.browse([a], {
      m3u8Only: true,
      limit: 1,
      page: 2,
    });
    expect(first.total).toBe(2);
    expect(first.pageCount).toBe(2);
    expect(first.results).toHaveLength(1);
    expect(second.results).toHaveLength(1);
    expect(
      await catalog.detail(a, 'format-file', { m3u8Only: true })
    ).toBeNull();
    expect(
      (await catalog.detail(a, 'format-mixed', { m3u8Only: true }))?.episodes
    ).toEqual(['https://video.test/a.M3U8?sign=keep']);
    expect((await catalog.detail(a, 'format-mixed'))?.episodes).toEqual([
      'https://video.test/a.mp4',
    ]);
    expect((await catalog.browse([a])).total).toBe(3);
  } finally {
    db.close();
  }
});
