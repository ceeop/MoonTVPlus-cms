/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { localCatalogSearch } from '@/lib/catalog/service';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { listEnabledSourceScripts } from '@/lib/source-script';
import type { SearchResult } from '@/lib/types';

import { GET as search } from './route';
import { GET as streamSearch } from './ws/route';

jest.mock('next/server', () => {
  // Jest 27 的隔离环境不包含 Node 的 Fetch/Streams 全局对象。
  const { Response, ReadableStream, TextEncoder, TextDecoder } = jest
    .requireActual('vm')
    .runInThisContext(
      '({ Response, ReadableStream, TextEncoder, TextDecoder })'
    );
  Object.assign(globalThis, {
    Response,
    ReadableStream,
    TextEncoder,
    TextDecoder,
  });
  return {
    NextResponse: {
      json: (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), init),
    },
  };
});

jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/catalog/service', () => ({ localCatalogSearch: jest.fn() }));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  getAvailableApiSites: jest.fn(),
  getCacheTime: async () => 60,
}));
jest.mock('@/lib/downstream', () => ({ searchFromApi: jest.fn() }));
jest.mock('@/lib/permissions', () => ({
  hasFeaturePermission: async () => false,
}));
jest.mock('@/lib/emby-token', () => ({ getProxyToken: async () => null }));
jest.mock('@/lib/emby-manager', () => ({
  embyManager: { getAllClients: async () => new Map() },
}));
jest.mock('@/lib/source-script', () => ({
  listEnabledSourceScripts: jest.fn(),
}));

const sites = [
  { key: 'a', name: '源 A', api: 'https://a.invalid/api' },
  { key: 'b', name: '源 B', api: 'https://b.invalid/api' },
];
const item = (source: string, id: string, desc = ''): SearchResult => ({
  source,
  id,
  desc,
  source_name: source,
  weight: 0,
  title: '测试影片',
  poster: '',
  year: '2026',
  episodes: ['https://example.invalid/1.m3u8'],
  episodes_titles: ['正片'],
  type_name: '电影',
});
const request = (params = '') =>
  ({
    url: `http://localhost/api/search?q=test${params}`,
  } as NextRequest);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const decodeEvents = (chunk: Uint8Array) =>
  new TextDecoder()
    .decode(chunk)
    .trim()
    .split('\n\n')
    .map((line) => JSON.parse(line.replace(/^data: /, '')));
const readEvents = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  const { value } = await reader.read();
  if (!value) throw new Error('搜索流提前结束');
  return decodeEvents(value);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
    username: 'test-user',
  });
  (getConfig as jest.Mock).mockResolvedValue({
    SourceConfig: sites,
    SiteConfig: { DisableYellowFilter: true },
  });
  (getAvailableApiSites as jest.Mock).mockResolvedValue(sites);
  (listEnabledSourceScripts as jest.Mock).mockResolvedValue([]);
  (localCatalogSearch as jest.Mock).mockResolvedValue([
    item('a', '1', '片库版本'),
  ]);
  (searchFromApi as jest.Mock).mockImplementation(async (site) => [
    item(site.key, '1', '最新版本'),
  ]);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('streams the catalog before source initialization, then each source independently', async () => {
  const scripts = deferred<[]>();
  const first = deferred<SearchResult[]>();
  const second = deferred<SearchResult[]>();
  (listEnabledSourceScripts as jest.Mock).mockReturnValue(scripts.promise);
  (searchFromApi as jest.Mock).mockImplementation((site) =>
    site.key === 'a' ? first.promise : second.promise
  );
  const response = await streamSearch(request());
  const reader = response.body?.getReader();
  if (!reader) throw new Error('搜索流不存在');
  const catalog = await readEvents(reader);
  expect(catalog).toEqual([
    { type: 'catalog_result', results: [item('a', '1', '片库版本')] },
  ]);
  expect(searchFromApi).not.toHaveBeenCalled();

  scripts.resolve([]);
  expect(await readEvents(reader)).toEqual([
    expect.objectContaining({ type: 'start', totalSources: 2 }),
  ]);
  first.resolve([item('a', '1', '最新版本')]);
  expect(await readEvents(reader)).toEqual([
    expect.objectContaining({ type: 'source_result', source: 'a' }),
  ]);
  second.resolve([item('b', '1')]);
  const remaining = await readEvents(reader);
  while (!remaining.some((event) => event.type === 'complete')) {
    remaining.push(...(await readEvents(reader)));
  }
  expect(remaining).toContainEqual(
    expect.objectContaining({
      type: 'complete',
      totalResults: 2,
      completedSources: 2,
    })
  );
  expect((await reader.read()).done).toBe(true);
  expect(searchFromApi).toHaveBeenCalledWith(sites[0], 'test', false, true);
});

test.each([null, []])(
  'still searches sources when the catalog returns %s',
  async (local) => {
    (localCatalogSearch as jest.Mock).mockResolvedValue(local);
    const events = (await (await streamSearch(request())).text())
      .trim()
      .split('\n\n')
      .map((line) => JSON.parse(line.replace(/^data: /, '')));
    expect(
      events.filter((event) => event.type === 'source_result')
    ).toHaveLength(2);
    expect(events[events.length - 1]).toMatchObject({
      type: 'complete',
      totalResults: 2,
    });
  }
);

test('finishes with catalog results when no online sources are available', async () => {
  (getAvailableApiSites as jest.Mock).mockResolvedValue([]);
  const text = await (await streamSearch(request())).text();
  expect(text).toContain('"totalSources":0');
  expect(text).toContain('"totalResults":1');
  expect(searchFromApi).not.toHaveBeenCalled();
});

test('source failures preserve catalog results and complete the stream', async () => {
  (searchFromApi as jest.Mock).mockRejectedValue(
    new Error('source unavailable')
  );
  const events = (await (await streamSearch(request())).text())
    .trim()
    .split('\n\n')
    .map((line) => JSON.parse(line.replace(/^data: /, '')));
  expect(events.filter((event) => event.type === 'source_error')).toHaveLength(
    2
  );
  expect(events[events.length - 1]).toMatchObject({
    type: 'complete',
    completedSources: 2,
    totalResults: 1,
  });
});

test('the JSON endpoint merges fresh data in place and retains unmatched catalog entries', async () => {
  (localCatalogSearch as jest.Mock).mockResolvedValue([
    item('a', '1', '片库版本'),
    item('a', '2'),
  ]);
  const response = await search(request('&online=1'));
  expect((await response.json()).results).toEqual([
    item('a', '1', '最新版本'),
    item('a', '2'),
    item('b', '1', '最新版本'),
  ]);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});

test.each([search, streamSearch])(
  'private-only searches never query the catalog or public sources',
  async (handler) => {
    const response = await handler(request('&privateOnly=1'));
    await response.text();
    expect(localCatalogSearch).not.toHaveBeenCalled();
    expect(getAvailableApiSites).not.toHaveBeenCalled();
    expect(searchFromApi).not.toHaveBeenCalled();
  }
);

test.each([search, streamSearch])(
  'refresh bypasses source response caches and preserves special scope',
  async (handler) => {
    const response = await handler(request('&fresh=1&special=1'));
    await response.text();
    expect(localCatalogSearch).toHaveBeenCalledWith('test-user', 'test', true);
    expect(getAvailableApiSites).toHaveBeenCalledWith('test-user', true);
    expect(searchFromApi).toHaveBeenCalledWith(sites[0], 'test', true, true);
  }
);
