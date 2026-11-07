/** @jest-environment node */

import Database from 'better-sqlite3';

import type { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import { SQLiteAdapter } from '@/lib/d1-adapter';

import {
  activeCatalogBindings,
  collectedCatalogCategories,
  removeCatalogCategory,
} from './category-config';
import { mergeCatalogCategories } from './cms-categories';
import { collectCatalog } from './collector';
import {
  type CatalogSettings,
  catalogScope,
  catalogSettings,
  normalizeCmsItem,
} from './model';
import {
  catalogTaxonomyRevision,
  mergeCollectionSettings,
  mergeTaxonomySettings,
  parseCatalogSettings,
} from './settings';
import { CatalogStore, getCatalogStore } from './store';

jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('./store', () => ({
  ...jest.requireActual('./store'),
  getCatalogStore: jest.fn(),
}));

const a = { key: 'a', name: '源 A', api: 'https://a.invalid/api' };
const fixture = (): CatalogSettings => ({
  ...catalogSettings({}),
  Enabled: true,
  SourceKeys: ['a'],
  CollectionCategoryIds: ['movie', 'action'],
  Categories: [
    {
      id: 'movie',
      name: '电影',
      kind: 'movie',
      parentId: '',
      enabled: true,
    },
    {
      id: 'action',
      name: '动作片',
      kind: 'movie',
      parentId: 'movie',
      enabled: true,
    },
  ],
  CategoryBindings: [
    { sourceKey: 'a', typeId: '1', categoryId: 'movie' },
    { sourceKey: 'a', typeId: '8', categoryId: 'action' },
  ],
  SourceCategories: [
    {
      sourceKey: 'a',
      categories: [
        { id: '1', name: '电影', parentId: '' },
        { id: '8', name: '动作片', parentId: '1' },
      ],
    },
  ],
});
let db: Database.Database;
let store: CatalogStore;
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  db = new Database(':memory:');
  store = new CatalogStore(new SQLiteAdapter(db));
  (getCatalogStore as jest.Mock).mockReturnValue(store);
});
afterEach(() => {
  db.close();
  global.fetch = originalFetch;
});
async function put() {
  const item = normalizeCmsItem(
    {
      vod_id: '1',
      vod_name: '影片',
      vod_year: '2026',
      type_id: '8',
      type_name: '动作片',
      vod_class: '剧情,冒险',
      vod_play_url: '正片$https://video.invalid/1.m3u8',
    },
    a
  );
  if (!item) throw new Error('Invalid fixture');
  await store.put(item, Date.now(), false);
}

test('collection selections stay independent from enabled state and apply to existing records', async () => {
  const settings = fixture();
  await put();
  settings.CollectionCategoryIds = ['movie'];
  expect(
    collectedCatalogCategories(settings).map((category) => category.id)
  ).toEqual(['movie']);
  expect(
    settings.Categories?.find((category) => category.id === 'action')?.enabled
  ).toBe(true);
  expect(await store.detail(a, '1', catalogScope(settings))).toBeNull();
  settings.CollectionCategoryIds.push('action');
  expect(await store.detail(a, '1', catalogScope(settings))).not.toBeNull();
});

test('category deletion cleans selections and bindings, preserves children, and survives source refresh', () => {
  const removed = removeCatalogCategory(fixture(), 'movie');
  expect(removed.Categories).toEqual([
    expect.objectContaining({ id: 'action', parentId: '', enabled: true }),
  ]);
  expect(removed.CollectionCategoryIds).toEqual(['action']);
  expect(removed.CategoryBindings?.[0].categoryId).toBe('');
  const refreshed = mergeCatalogCategories(
    removed,
    removed.SourceCategories || []
  );
  expect(
    refreshed.Categories?.some((category) => category.id === 'movie')
  ).toBe(false);
  expect(refreshed.CategoryBindings?.[0].categoryId).toBe('');
  const disabled = fixture();
  if (disabled.Categories?.[0]) disabled.Categories[0].enabled = false;
  expect(removeCatalogCategory(disabled, 'movie').Categories?.[0].enabled).toBe(
    false
  );
});

test('collection saves cannot restore deleted or renamed taxonomy from a stale page', () => {
  const current = fixture();
  if (current.Categories?.[0]) current.Categories[0].name = '新电影馆';
  const old = fixture();
  old.IntervalMinutes = 90;
  const merged = mergeCollectionSettings(
    current,
    old as unknown as Record<string, unknown>
  );
  expect(merged.Categories?.[0].name).toBe('新电影馆');
  expect(merged.IntervalMinutes).toBe(90);
  const removed = removeCatalogCategory(current, 'action');
  expect(() =>
    mergeCollectionSettings(removed, old as unknown as Record<string, unknown>)
  ).toThrow('已删除');
});

test('taxonomy saves preserve current collection configuration and permit deleting the last category', () => {
  const current = fixture();
  current.CleanupEnabled = false;
  current.RetentionMonths = 12;
  const removed = removeCatalogCategory(
    removeCatalogCategory(current, 'action'),
    'movie'
  );
  const next = mergeTaxonomySettings(current, {
    ...removed,
    SourceKeys: ['unrelated'],
    IntervalMinutes: 1440,
    Enabled: false,
    CleanupEnabled: true,
    RetentionMonths: 1,
  });
  expect(next.SourceKeys).toEqual(['a']);
  expect(next.IntervalMinutes).toBe(current.IntervalMinutes);
  expect(next.Enabled).toBe(true);
  expect(next.CleanupEnabled).toBe(false);
  expect(next.RetentionMonths).toBe(12);
  expect(next.Categories).toEqual([]);
  expect(next.CollectionCategoryIds).toEqual([]);
  expect(activeCatalogBindings(next)).toEqual([]);
});

test.each([0, -1, 1.5, 121, NaN, Infinity, '6'])(
  'invalid retention months are rejected before settings are saved: %s',
  (RetentionMonths) => {
    expect(() =>
      parseCatalogSettings({ ...fixture(), RetentionMonths })
    ).toThrow('整数月数');
  }
);

test('older collection clients preserve saved cleanup settings when they omit the fields', () => {
  const current = { ...fixture(), CleanupEnabled: false, RetentionMonths: 12 };
  const draft: Record<string, unknown> = { ...fixture() };
  delete draft.CleanupEnabled;
  delete draft.RetentionMonths;
  expect(mergeCollectionSettings(current, draft)).toEqual(
    expect.objectContaining({ CleanupEnabled: false, RetentionMonths: 12 })
  );
});

test('all-disabled taxonomy pauses fetching while retention continues', async () => {
  const settings = fixture();
  settings.Categories = settings.Categories?.map((category) => ({
    ...category,
    enabled: false,
  }));
  (getConfig as jest.Mock).mockResolvedValue({
    CatalogConfig: settings,
    SourceConfig: [a],
    SiteConfig: { DisableYellowFilter: false },
  } as unknown as AdminConfig);
  global.fetch = jest.fn();
  const result = await collectCatalog();
  expect(result.processed).toBe(0);
  expect(result.message).toContain('暂无可采集分类');
  expect(global.fetch).not.toHaveBeenCalled();
  expect(await store.cleanupStatus()).not.toBeNull();
});

test('taxonomy revisions ignore collection choices and detect category edits', () => {
  const settings = fixture();
  const revision = catalogTaxonomyRevision(settings);
  expect(
    catalogTaxonomyRevision({ ...settings, CollectionCategoryIds: [] })
  ).toBe(revision);
  if (settings.Categories?.[0]) settings.Categories[0].name = '电影馆';
  expect(catalogTaxonomyRevision(settings)).not.toBe(revision);
  settings.CategoryBindings = [
    { sourceKey: 'a', typeId: '1', categoryId: 'missing' },
  ];
  expect(() => parseCatalogSettings(settings)).toThrow('不存在');
});

test('existing category settings retain their bindings while obsolete metadata is stripped', () => {
  const current = fixture();
  const parsed = parseCatalogSettings({
    ...current,
    Tags: [{ id: 'old', name: '旧标记', aliases: [], enabled: true }],
    Categories: current.Categories?.map((category) => ({
      ...category,
      tagIds: ['old'],
    })),
  });
  expect(Object.prototype.hasOwnProperty.call(parsed, 'Tags')).toBe(false);
  expect(
    parsed.Categories?.some((category) =>
      Object.prototype.hasOwnProperty.call(category, 'tagIds')
    )
  ).toBe(false);
  expect(parsed.CategoryBindings).toEqual(current.CategoryBindings);
  expect(parsed.CollectionCategoryIds).toEqual(current.CollectionCategoryIds);
});

test('settings writes are serialized across store instances and stale writers cannot unlock another save', async () => {
  const another = new CatalogStore(new SQLiteAdapter(db));
  expect(await store.acquireSettingsLock('first')).toBe(true);
  expect(await another.acquireSettingsLock('second')).toBe(false);
  await another.releaseSettingsLock('wrong');
  expect(await another.acquireSettingsLock('second')).toBe(false);
  await store.releaseSettingsLock('first');
  expect(await another.acquireSettingsLock('second')).toBe(true);
  await store.releaseSettingsLock('first');
  expect(await store.acquireSettingsLock('third')).toBe(false);
});
