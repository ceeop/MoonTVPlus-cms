import { getCatalogStore } from '@/lib/catalog/store';
import { getConfig } from '@/lib/config';
import { getCachedSearchPage } from '@/lib/search-cache';
import type { SearchResult } from '@/lib/types';

import { getDetailFromApiV2, searchFromApi } from './downstream';

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  API_CONFIG: { search: { headers: {} }, detail: { headers: {} } },
}));
jest.mock('@/lib/catalog/store', () => ({ getCatalogStore: jest.fn() }));
jest.mock('@/lib/search-cache', () => ({
  getCachedSearchPage: jest.fn(),
  setCachedSearchPage: jest.fn(),
}));
jest.mock('@/lib/utils', () => ({ cleanHtmlTags: (text: string) => text }));

const site = { key: 'a', name: '源 A', api: 'https://a.invalid/api' };
const results: SearchResult[] = [
  {
    id: '1',
    source: 'a',
    source_name: '源 A',
    title: '测试',
    year: '2026',
    poster: '',
    episodes: ['1.m3u8'],
    episodes_titles: ['正片'],
  },
];
const localSearch = jest.fn();
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  (getConfig as jest.Mock).mockResolvedValue({
    SiteConfig: { SearchDownstreamMaxPage: 1 },
    CatalogConfig: { Enabled: true, SourceKeys: ['a'] },
  });
  (getCatalogStore as jest.Mock).mockReturnValue({ search: localSearch });
  localSearch.mockResolvedValue([]);
  (getCachedSearchPage as jest.Mock).mockReturnValue({
    status: 'ok',
    data: results,
  });
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, text: async () => '{"list":[]}' });
});
afterEach(() => {
  global.fetch = originalFetch;
});

test('unified source searches use recent source responses instead of searching the catalog again', async () => {
  await expect(searchFromApi(site, '测试', false, true)).resolves.toEqual(
    results
  );
  expect(localSearch).not.toHaveBeenCalled();
  expect(getCachedSearchPage).toHaveBeenCalledWith('a', '测试', 1);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('refresh requests go to the source even when its previous response is cached', async () => {
  await searchFromApi(site, '测试', true, true);
  expect(localSearch).not.toHaveBeenCalled();
  expect(getCachedSearchPage).not.toHaveBeenCalled();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('existing catalog-only callers retain their behavior', async () => {
  await searchFromApi(site, '测试');
  expect(localSearch).toHaveBeenCalledTimes(1);
  expect(getCachedSearchPage).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('cached source responses follow the global setting and remain complete when it is disabled again', async () => {
  const cached = [
    {
      ...results[0],
      episodes: ['https://video.test/a.mp4'],
      catalog_play_lines: [
        { name: 'file', urls: ['https://video.test/a.mp4'], titles: ['文件'] },
        {
          name: 'hls',
          urls: ['https://video.test/a.m3u8?sign=keep'],
          titles: ['第四集'],
        },
      ],
    },
  ];
  (getCachedSearchPage as jest.Mock).mockReturnValue({
    status: 'ok',
    data: cached,
  });
  (getConfig as jest.Mock).mockResolvedValue({
    SiteConfig: { M3u8Only: true, SearchDownstreamMaxPage: 1 },
    CatalogConfig: { Enabled: false },
  });
  expect((await searchFromApi(site, '测试', false, true))[0].episodes).toEqual([
    'https://video.test/a.m3u8?sign=keep',
  ]);
  expect(cached[0].episodes).toEqual(['https://video.test/a.mp4']);
  (getConfig as jest.Mock).mockResolvedValue({
    SiteConfig: { M3u8Only: false, SearchDownstreamMaxPage: 1 },
    CatalogConfig: { Enabled: false },
  });
  expect((await searchFromApi(site, '测试', false, true))[0].episodes).toEqual([
    'https://video.test/a.mp4',
  ]);
});

test('fresh web details select the M3U8 alternative under the global setting', async () => {
  (getConfig as jest.Mock).mockResolvedValue({
    SiteConfig: { M3u8Only: true },
    CatalogConfig: { Enabled: false },
  });
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    text: async () =>
      JSON.stringify({
        list: [
          {
            vod_id: '1',
            vod_name: '测试',
            vod_play_from: 'file$$$hls',
            vod_play_url:
              '文件$https://video.test/a.mp4$$$第四集$https://video.test/a.m3u8?sign=keep',
          },
        ],
      }),
  });
  const detail = await getDetailFromApiV2(site, '1', true);
  expect(detail.episodes).toEqual(['https://video.test/a.m3u8?sign=keep']);
  expect(detail.episodes_titles).toEqual(['第四集']);
});
