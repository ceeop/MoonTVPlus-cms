import type { CatalogCard } from '@/lib/catalog/model';
import { catalogScope } from '@/lib/catalog/model';
import { POSTER_PREFIX } from '@/lib/catalog/posters';
import { getCatalogStore } from '@/lib/catalog/store';
import type { SearchResult } from '@/lib/types';

import { tvboxCatalogContext } from './access';
import { isTVBoxM3u8Url, proxyTVBoxHlsUrl } from './cms';

const label = (value: string) => value.replace(/[$#]/g, ' ').trim();
const directMedia = /^https?:\/\/.*\.(?:m3u8|mp4|mkv|flv|webm)(?:[?#]|$)/i;

export function tvboxPoster(poster: string, baseUrl: string, token: string) {
  return poster.startsWith(POSTER_PREFIX)
    ? `${baseUrl}/api/tvbox/catalog/${encodeURIComponent(
        token
      )}/poster/${poster.slice(POSTER_PREFIX.length)}`
    : '';
}

function card(item: SearchResult, id: string, baseUrl: string, token: string) {
  return {
    vod_id: id,
    vod_name: item.title,
    vod_pic: tvboxPoster(item.poster, baseUrl, token),
    vod_year: item.year,
    vod_remarks: item.vod_remarks || '',
    vod_content: item.desc || '',
    type_name: item.type_name || '',
  };
}

export function tvboxDetail(
  resources: SearchResult[],
  id: string,
  baseUrl: string,
  token: string,
  adFilter = false,
  m3u8Only = false
) {
  if (!resources.length) return null;
  const names: string[] = [];
  const lines: string[] = [];
  const counts = new Map<string, number>();
  for (const item of resources) {
    const stored = (
      item as SearchResult & {
        catalog_play_lines?: Array<{
          name: string;
          urls: string[];
          titles: string[];
        }>;
      }
    ).catalog_play_lines;
    const sourceLines = stored?.length
      ? stored
      : [{ name: '默认', urls: item.episodes, titles: item.episodes_titles }];
    for (const line of sourceLines) {
      const episodes = line.urls.flatMap((url, index) => {
        if (!directMedia.test(url)) return [];
        if (m3u8Only && !isTVBoxM3u8Url(url)) return [];
        const playUrl =
          adFilter && isTVBoxM3u8Url(url)
            ? proxyTVBoxHlsUrl(url, baseUrl, item.source)
            : url;
        return [
          `${label(line.titles[index] || `第${index + 1}集`)}$${playUrl.replace(
            /#/g,
            '%23'
          )}`,
        ];
      });
      if (!episodes.length) continue;
      const name = label(`${item.source_name} · ${line.name}`);
      const count = (counts.get(name) || 0) + 1;
      counts.set(name, count);
      names.push(count === 1 ? name : `${name} (${count})`);
      lines.push(episodes.join('#'));
    }
  }
  if (!lines.length) return null;
  return {
    ...card(resources[0], id, baseUrl, token),
    vod_play_from: names.join('$$$'),
    vod_play_url: lines.join('$$$'),
  };
}

export async function tvboxCatalog(
  token: string,
  params: URLSearchParams,
  baseUrl: string
) {
  const { config, settings, sites } = await tvboxCatalogContext(token);
  const store = getCatalogStore();
  const scope = {
    ...catalogScope(settings, config.SiteConfig.M3u8Only === true),
    excludeRestricted:
      !config.SiteConfig.DisableYellowFilter ||
      params.get('yellowFilter') === 'true',
  };
  const ids = params.get('ids');
  if (ids) {
    const unique = Array.from(new Set(ids.split(','))).slice(0, 20);
    const list = [];
    for (const id of unique) {
      if (!/^[a-f0-9]{32}$/.test(id)) continue;
      const resources = await store.search(sites, {
        ...scope,
        workId: id,
        limit: 500,
      });
      const item = tvboxDetail(
        resources,
        id,
        baseUrl,
        token,
        params.get('adFilter') === 'true',
        config.SiteConfig.M3u8Only === true
      );
      if (item) list.push(item);
    }
    return {
      code: 1,
      page: 1,
      pagecount: list.length ? 1 : 0,
      limit: 20,
      total: list.length,
      list,
    };
  }
  let filters: Record<string, unknown> = {};
  try {
    const value = JSON.parse(params.get('f') || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value))
      filters = value;
  } catch {
    /* Older clients send filters as individual query parameters. */
  }
  const category = (params.get('t') || '').slice(0, 100);
  const page = Math.max(
    1,
    Math.min(100000, Math.floor(Number(params.get('pg')) || 1))
  );
  const limit = 30;
  const result = await store.browse(sites, {
    ...scope,
    ...(settings.Categories !== undefined
      ? { categoryId: category }
      : { kind: category }),
    query: (params.get('wd') || '').slice(0, 40),
    year: String(params.get('year') || filters.year || '').slice(0, 4),
    area: String(params.get('area') || filters.area || '').slice(0, 40),
    page,
    limit,
    order: 'updated',
  });
  const categories = result.categories.map((item) => ({
    type_id: item.id,
    type_name: item.name,
    type_pid: item.parentId || '0',
  }));
  const filterRows = [
    {
      key: 'year',
      name: '年份',
      value: [
        { n: '全部', v: '' },
        ...result.years.map((value) => ({ n: value, v: value })),
      ],
    },
    {
      key: 'area',
      name: '地区',
      value: [
        { n: '全部', v: '' },
        ...result.areas.map((value) => ({ n: value, v: value })),
      ],
    },
  ];
  return {
    code: 1,
    page: result.page,
    pagecount: result.pageCount,
    limit,
    total: result.total,
    class: categories,
    filters: Object.fromEntries(
      categories.map((item) => [item.type_id, filterRows])
    ),
    list: result.results.map((item: CatalogCard) =>
      card(item, item.work_id, baseUrl, token)
    ),
  };
}
