import { createHash } from 'crypto';

import type { AdminConfig } from '@/lib/admin.types';
import type { ApiSite } from '@/lib/config';
import type { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

import {
  type CatalogCategoryConfig,
  activeCatalogBindings,
  catalogCategoryScope,
} from './category-config';
import { normalizeCatalogPosterUrl } from './posters';

export type CatalogKind = 'movie' | 'tv' | 'anime' | 'variety' | 'other';
export const CATALOG_KINDS: CatalogKind[] = [
  'movie',
  'tv',
  'anime',
  'variety',
  'other',
];
export interface CatalogSettings extends CatalogCategoryConfig {
  Enabled: boolean;
  SourceKeys: string[];
  DefaultSourceKey?: string;
  IntervalMinutes: number;
  CleanupEnabled?: boolean;
  RetentionMonths?: number;
  Kinds: CatalogKind[];
}
export interface CatalogItem {
  revision: string;
  restricted: boolean;
  workId: string;
  title: string;
  normalizedTitle: string;
  kind: CatalogKind;
  year: string;
  area: string;
  typeId: string;
  updatedAt: number;
  result: SearchResult;
  playLines: Array<{ name: string; urls: string[]; titles: string[] }>;
}
export interface SyncState {
  fingerprint: string;
  nextPage: number;
  totalPages: number;
  fullDone: boolean;
  lastSuccess: number;
  startedAt: number;
  windowHours: number;
  action: 'full' | 'incremental';
  error: string;
  retryAt: number;
}
export interface CatalogCard extends SearchResult {
  work_id: string;
  kind: CatalogKind;
  area: string;
  resource_count: number;
  updated_at: number;
}

export function catalogSettings(
  config: Pick<AdminConfig, 'CatalogConfig'>
): CatalogSettings {
  const value = config.CatalogConfig;
  const sourceKeys = Array.from(
    new Set(
      Array.isArray(value?.SourceKeys)
        ? (value?.SourceKeys || []).filter((key) => typeof key === 'string')
        : []
    )
  ).slice(0, 40);
  const retentionMonths = value?.RetentionMonths;
  return {
    Enabled: value?.Enabled === true,
    SourceKeys: sourceKeys,
    DefaultSourceKey:
      value?.DefaultSourceKey && sourceKeys.includes(value.DefaultSourceKey)
        ? value.DefaultSourceKey
        : sourceKeys[0] || '',
    IntervalMinutes: Math.max(
      5,
      Math.min(1440, Number(value?.IntervalMinutes) || 30)
    ),
    CleanupEnabled: value?.CleanupEnabled !== false,
    RetentionMonths:
      typeof retentionMonths === 'number' &&
      Number.isInteger(retentionMonths) &&
      retentionMonths >= 1 &&
      retentionMonths <= 120
        ? retentionMonths
        : 6,
    Kinds:
      value?.Kinds === undefined
        ? [...CATALOG_KINDS]
        : CATALOG_KINDS.filter(
            (kind) => Array.isArray(value.Kinds) && value.Kinds.includes(kind)
          ),
    ...(Array.isArray(value?.Categories)
      ? {
          Categories: (value?.Categories || []).map(
            ({ id, name, kind, parentId, enabled }) => ({
              id,
              name,
              kind,
              parentId,
              enabled,
            })
          ),
          CategoryBindings: value?.CategoryBindings || [],
          SourceCategories: value?.SourceCategories || [],
          ...(value?.CollectionCategoryIds !== undefined
            ? { CollectionCategoryIds: value.CollectionCategoryIds }
            : {}),
        }
      : {}),
  };
}

// Clamp month-end dates instead of overflowing into the next month.
export function catalogRetentionCutoff(now = Date.now(), months = 6): number {
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}

// Use China calendar days regardless of the deployment's system timezone.
export function catalogCollectionDay(now = Date.now()) {
  const day = 86400000;
  const offset = 8 * 3600000;
  const start = Math.floor((now + offset) / day) * day - offset;
  return { start, end: start + day };
}

export function catalogItemEnabled(
  config: AdminConfig,
  item: CatalogItem
): boolean {
  const settings = catalogSettings(config);
  return (
    catalogSourceEnabled(config, item.result.source) &&
    config.SourceConfig.some(
      (site) => site.key === item.result.source && !site.disabled
    ) &&
    (settings.Categories !== undefined || settings.Kinds.includes(item.kind)) &&
    (settings.Categories === undefined ||
      activeCatalogBindings(settings).some(
        (binding) =>
          binding.sourceKey === item.result.source &&
          binding.typeId === item.typeId
      )) &&
    (config.SiteConfig.DisableYellowFilter || !item.restricted)
  );
}

export function catalogScope(settings: CatalogSettings, m3u8Only = false) {
  return {
    m3u8Only,
    defaultSourceKey: settings.DefaultSourceKey || settings.SourceKeys[0],
    cleanupEnabled: settings.CleanupEnabled !== false,
    retentionMonths: settings.RetentionMonths ?? 6,
    kinds: settings.Categories === undefined ? settings.Kinds : undefined,
    ...catalogCategoryScope(settings),
  };
}

export function catalogSourceEnabled(
  config: AdminConfig,
  key: string
): boolean {
  const settings = catalogSettings(config);
  return settings.Enabled && settings.SourceKeys.includes(key);
}

export function sourceRevision(site: ApiSite): string {
  return createHash('sha256').update(`${site.key}\n${site.api}`).digest('hex');
}

export function normalizeTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(new RegExp('[\\s\\p{P}\\p{S}]', 'gu'), '');
}

// Single characters support one-character queries; bigrams also index Chinese titles.
export function titleTerms(value: string, query = false): string[] {
  const chars = Array.from(normalizeTitle(value).slice(0, 200));
  const pairs = chars.slice(1).map((char, i) => chars[i] + char);
  return Array.from(
    new Set(query && pairs.length ? pairs : [...chars, ...pairs])
  );
}

export function classifyVideo(typeName: string): CatalogKind {
  if (/动漫|动画|番剧/.test(typeName)) return 'anime';
  if (/综艺|真人秀|脱口秀/.test(typeName)) return 'variety';
  if (
    /电视剧|连续剧|剧集|短剧|国产剧|港台剧|香港剧|台湾剧|欧美剧|日韩剧|日本剧|韩国剧|日剧|韩剧|美剧|泰剧|海外剧/.test(
      typeName
    )
  )
    return 'tv';
  if (/电影|片/.test(typeName)) return 'movie';
  return 'other';
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

// CMS update dates without a timezone use China standard time.
export function cmsUpdatedAt(value: unknown): number {
  const time = stringValue(value);
  const parsed = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(time)
    ? Date.parse(time.replace(' ', 'T') + '+08:00')
    : Date.parse(time);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeCmsItem(
  raw: Record<string, unknown>,
  site: ApiSite
): CatalogItem | null {
  const id = stringValue(raw.vod_id);
  const title = stringValue(raw.vod_name).trim().replace(/\s+/g, ' ');
  if (!id || !title) return null;
  const typeName = stringValue(raw.type_name);
  const kind = classifyVideo(typeName);
  const year = stringValue(raw.vod_year).match(/\d{4}/)?.[0] || '';
  const doubanId = Number(raw.vod_douban_id) || 0;
  const normalizedTitle = normalizeTitle(title);
  // Preserve seasons/editions in the title; unknown years/categories stay separate.
  const identity =
    doubanId > 0
      ? `douban:${doubanId}:${kind}`
      : year && kind !== 'other'
      ? `title:${normalizedTitle}:${year}:${kind}`
      : `resource:${site.key}:${id}`;
  const workId = createHash('sha256')
    .update(identity)
    .digest('hex')
    .slice(0, 32);
  const names = stringValue(raw.vod_play_from).split('$$$');
  const playLines = stringValue(raw.vod_play_url)
    .split('$$$')
    .map((line, index) => {
      const urls: string[] = [];
      const titles: string[] = [];
      line.split('#').forEach((episode) => {
        const separator = episode.indexOf('$');
        const url = (
          separator < 0 ? episode : episode.slice(separator + 1)
        ).trim();
        if (/^https?:\/\//i.test(url)) {
          titles.push(
            separator < 0
              ? `第${urls.length + 1}集`
              : episode.slice(0, separator)
          );
          urls.push(url);
        }
      });
      return { name: names[index] || `线路${index + 1}`, urls, titles };
    })
    .filter((line) => line.urls.length);
  const directLines = playLines.filter((line) =>
    line.urls.every((url) => /\.(m3u8|mp4|mkv|flv|webm)(?:[?#]|$)/i.test(url))
  );
  const preferred = [...directLines].sort(
    (a, b) => b.urls.length - a.urls.length
  )[0];
  // The existing player consumes direct media URLs. Keep incompatible resources out of the wall.
  if (!preferred) return null;
  return {
    revision: sourceRevision(site),
    restricted: yellowWords.some((word) => typeName.includes(word)),
    workId,
    title,
    normalizedTitle,
    kind,
    year,
    area: stringValue(raw.vod_area),
    typeId: stringValue(raw.type_id),
    updatedAt: cmsUpdatedAt(raw.vod_time),
    playLines,
    result: {
      id,
      title,
      source: site.key,
      source_name: site.name,
      poster: normalizeCatalogPosterUrl(stringValue(raw.vod_pic)),
      year,
      episodes: preferred.urls,
      episodes_titles: preferred.titles,
      desc: stringValue(raw.vod_content)
        .replace(/<[^>]*>/g, '')
        .trim(),
      type_name: typeName,
      class: stringValue(raw.vod_class),
      douban_id: doubanId,
      vod_remarks: stringValue(raw.vod_remarks),
      vod_total: Number(raw.vod_total) || undefined,
      proxyMode: site.proxyMode || false,
    },
  };
}

export function cmsUrl(
  api: string,
  params: Record<string, string | number>
): string {
  const url = new URL(api);
  // Discard old query filters, preserving source authentication parameters.
  ['wd', 'pg', 'h', 'ids', 't'].forEach((key) => url.searchParams.delete(key));
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, String(value))
  );
  return url.toString();
}
