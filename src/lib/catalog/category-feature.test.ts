/** @jest-environment node */

import Database from 'better-sqlite3';

import type { AdminConfig } from '@/lib/admin.types';
import { SQLiteAdapter } from '@/lib/d1-adapter';

import {
  type CatalogCategoryConfig,
  activeCatalogBindings,
  categoryCollectionPolicy,
} from './category-config';
import { fetchCmsCategories, mergeCatalogCategories } from './cms-categories';
import {
  catalogItemEnabled,
  catalogRetentionCutoff,
  catalogScope,
  catalogSettings,
  normalizeCmsItem,
} from './model';
import { parseCatalogSettings } from './settings';
import { CatalogStore } from './store';

const a = { key: 'a', name: '源 A', api: 'https://a.invalid/api?token=keep' };
const b = { key: 'b', name: '源 B', api: 'https://b.invalid/api' };
const base = () => ({
  ...catalogSettings({}),
  Enabled: true,
  SourceKeys: ['a', 'b'],
});
const snapshots = [
  {
    sourceKey: 'a',
    categories: [
      { id: '1', name: '电影', parentId: '' },
      { id: '8', name: '动作片', parentId: '1' },
      { id: '9', name: '动漫电影', parentId: '1' },
      { id: '2', name: '连续剧', parentId: '' },
    ],
  },
  {
    sourceKey: 'b',
    categories: [
      { id: '99', name: '动作片', parentId: '' },
      { id: '8', name: '未对应分类', parentId: '' },
    ],
  },
];
const raw = (id = '1', typeId = '8') => ({
  vod_id: id,
  vod_name: '同一作品',
  vod_year: '2026',
  type_id: typeId,
  type_name: '动作片',
  vod_play_url: '正片$https://video.invalid/1.m3u8',
});
const normalize = (site = a, id = '1', typeId = '8') => {
  const item = normalizeCmsItem(raw(id, typeId), site);
  if (!item) throw new Error('Invalid fixture');
  return item;
};
let db: Database.Database;
let store: CatalogStore;
const originalFetch = global.fetch;
beforeEach(() => {
  db = new Database(':memory:');
  store = new CatalogStore(new SQLiteAdapter(db));
});
afterEach(() => {
  db.close();
  global.fetch = originalFetch;
});

test('imports the first selected source, preserves its hierarchy and matches names across source IDs', () => {
  const settings = mergeCatalogCategories(base(), [...snapshots].reverse());
  expect(settings.Categories?.map((category) => category.name)).toEqual([
    '电影',
    '动作片',
    '动漫电影',
    '连续剧',
  ]);
  const movie = settings.Categories?.find(
    (category) => category.name === '电影'
  );
  const animated = settings.Categories?.find(
    (category) => category.name === '动漫电影'
  );
  expect(animated).toMatchObject({ kind: 'movie', parentId: movie?.id });
  const first = settings.CategoryBindings?.find(
    (binding) => binding.sourceKey === 'a' && binding.typeId === '8'
  );
  expect(
    settings.CategoryBindings?.find(
      (binding) => binding.sourceKey === 'b' && binding.typeId === '99'
    )?.categoryId
  ).toBe(first?.categoryId);
  expect(
    settings.CategoryBindings?.find(
      (binding) => binding.sourceKey === 'b' && binding.typeId === '8'
    )?.categoryId
  ).toBe('');
});

test('refresh preserves edited names, disabled flags and explicit unbound selections', () => {
  const settings = mergeCatalogCategories(base(), snapshots);
  const action = settings.Categories?.find(
    (category) => category.name === '动作片'
  );
  if (!action) throw new Error('Missing fixture');
  action.name = '动作影院';
  action.enabled = false;
  const binding = settings.CategoryBindings?.find(
    (entry) => entry.sourceKey === 'b' && entry.typeId === '99'
  );
  if (!binding) throw new Error('Missing fixture');
  binding.categoryId = '';
  const refreshed = mergeCatalogCategories(settings, snapshots);
  expect(
    refreshed.Categories?.find((entry) => entry.id === action.id)
  ).toMatchObject({ name: '动作影院', enabled: false });
  expect(
    refreshed.CategoryBindings?.find(
      (entry) => entry.sourceKey === 'b' && entry.typeId === '99'
    )?.categoryId
  ).toBe('');
  expect(() =>
    mergeCatalogCategories(base(), [
      { sourceKey: 'a', categories: [], error: 'timeout' },
    ])
  ).toThrow('默认源');
});

test('fetches CMS categories with authentication query parameters intact', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: async () =>
      JSON.stringify({
        class: [{ type_id: 8, type_name: '动作片', type_pid: 0 }],
      }),
  });
  expect((await fetchCmsCategories(a)).categories).toEqual([
    { id: '8', name: '动作片', parentId: '' },
  ]);
  const request = new URL(String((global.fetch as jest.Mock).mock.calls[0][0]));
  expect(request.searchParams.get('token')).toBe('keep');
  expect(request.searchParams.get('ac')).toBe('list');
});

test('an explicit default source supplies the initial categories regardless of selection order', () => {
  const settings = mergeCatalogCategories(
    { ...base(), DefaultSourceKey: 'b' },
    snapshots
  );
  expect(settings.Categories?.map((category) => category.name)).toEqual([
    '动作片',
    '未对应分类',
  ]);
  expect(
    settings.CategoryBindings?.find(
      (binding) => binding.sourceKey === 'b' && binding.typeId === '8'
    )?.categoryId
  ).toBeTruthy();
  expect(() =>
    parseCatalogSettings({ ...settings, DefaultSourceKey: 'missing' })
  ).toThrow('默认源必须');
  expect(
    catalogSettings({
      CatalogConfig: { ...base(), DefaultSourceKey: 'removed' },
    }).DefaultSourceKey
  ).toBe('a');
});

test('changing the default source adds its hierarchy without discarding custom taxonomy or mutating the draft', () => {
  const original = mergeCatalogCategories(base(), snapshots);
  const before = JSON.stringify(original);
  const next = mergeCatalogCategories(
    { ...original, DefaultSourceKey: 'b' },
    [
      {
        sourceKey: 'b',
        categories: [
          { id: '10', name: '新电影', parentId: '' },
          { id: '11', name: '新动作片', parentId: '10' },
        ],
      },
    ],
    true
  );
  const parent = next.Categories?.find(
    (category) => category.name === '新电影'
  );
  expect(
    next.Categories?.find((category) => category.name === '新动作片')?.parentId
  ).toBe(parent?.id);
  expect(
    next.Categories?.find((category) => category.name === '电影')?.id
  ).toBe(original.Categories?.[0].id);
  expect(JSON.stringify(original)).toBe(before);
  expect(parseCatalogSettings(next).DefaultSourceKey).toBe('b');
});

test('unbound and disabled categories are rejected by the common ingestion policy', () => {
  const settings = mergeCatalogCategories(base(), snapshots);
  const config = {
    CatalogConfig: settings,
    SourceConfig: [a, b],
    SiteConfig: { DisableYellowFilter: false },
  } as unknown as AdminConfig;
  expect(catalogItemEnabled(config, normalize())).toBe(true);
  expect(catalogItemEnabled(config, normalize(b, '2', '8'))).toBe(false);
  const parent = settings.Categories?.find(
    (category) => category.name === '电影'
  );
  if (!parent) throw new Error('Missing fixture');
  parent.enabled = false;
  expect(catalogItemEnabled(config, normalize())).toBe(false);
  expect(
    activeCatalogBindings(settings).some((binding) => binding.typeId === '8')
  ).toBe(false);
});

test('mapped queries aggregate source categories, include children and hide empty or inaccessible categories', async () => {
  const settings = mergeCatalogCategories(base(), snapshots);
  await store.put(normalize(), Date.now(), false);
  await store.put(normalize(b, '2', '99'), Date.now(), false);
  await store.put(normalize(b, '3', '8'), Date.now(), false);
  const movie = settings.Categories?.find(
    (category) => category.name === '电影'
  );
  const wall = await store.browse([a, b], {
    ...catalogScope(settings),
    categoryId: movie?.id,
  });
  expect(wall.total).toBe(1);
  expect(wall.results[0].resource_count).toBe(2);
  expect(wall.categories.map((category) => category.name)).toEqual([
    '电影',
    '动作片',
  ]);
  expect(await store.detail(b, '3', catalogScope(settings))).toBeNull();
  expect(
    await store.search([a], {
      ...catalogScope(settings),
      categoryId: 'unknown',
    })
  ).toEqual([]);
  expect((await store.browse([], catalogScope(settings))).categories).toEqual(
    []
  );
  expect(await store.categories(b, catalogScope(settings))).toEqual([
    { type_id: '99', type_name: '动作片' },
  ]);
});

test('renaming categories applies to old data without creating a new mapping scope; unbinding hides it immediately', async () => {
  const settings = mergeCatalogCategories(base(), snapshots);
  await store.put(normalize(), Date.now(), false);
  await store.browse([a], catalogScope(settings));
  const policy = categoryCollectionPolicy(settings);
  const action = settings.Categories?.find(
    (category) => category.name === '动作片'
  );
  if (!action) throw new Error('Missing fixture');
  action.name = '动作影院';
  expect(categoryCollectionPolicy(settings)).toBe(policy);
  expect(
    (await store.browse([a], catalogScope(settings))).categories.map(
      (category) => category.name
    )
  ).toContain('动作影院');
  expect(
    await store.rows('SELECT id FROM catalog_category_scopes')
  ).toHaveLength(1);
  settings.CategoryBindings = settings.CategoryBindings?.map((binding) =>
    binding.sourceKey === 'a' ? { ...binding, categoryId: '' } : binding
  );
  expect((await store.browse([a], catalogScope(settings))).total).toBe(0);
  expect((await store.browse([a], catalogScope(settings))).categories).toEqual(
    []
  );
  expect(await store.search([b], catalogScope(settings))).toEqual([]);
});

test('legacy filters also hide categories with no fresh, visible resources', async () => {
  await store.put(normalize(), catalogRetentionCutoff() - 1, false);
  expect((await store.browse([a])).categories).toEqual([]);
  await store.put(normalize(), Date.now(), false);
  expect(
    (await store.browse([a])).categories.map((category) => category.id)
  ).toEqual(['movie']);
});

test('lightweight navigation applies source permissions, retention and category changes', async () => {
  const settings = mergeCatalogCategories(base(), snapshots);
  await store.put(normalize(), Date.now(), false);
  await store.put(normalize(b, '2', '99'), catalogRetentionCutoff() - 1, false);
  const options = catalogScope(settings);
  const visible = await store.navigation([a, b], options);
  expect(visible).toEqual((await store.browse([a, b], options)).categories);
  expect(await store.navigation([b], options)).toEqual([]);
  expect(await store.navigation([], options)).toEqual([]);

  const action = settings.Categories?.find(
    (category) => category.name === '动作片'
  );
  if (!action) throw new Error('Missing fixture');
  action.name = '动作影院';
  expect(
    (await store.navigation([a], options)).map((category) => category.name)
  ).toContain('动作影院');
  action.enabled = false;
  expect(await store.navigation([a], options)).toEqual([]);
});

test('mapped major kinds follow the configured system category even when the source label is unknown', async () => {
  const settings = mergeCatalogCategories(base(), snapshots);
  const item = normalizeCmsItem({ ...raw(), type_name: '未知类型' }, a);
  if (!item) throw new Error('Missing fixture');
  await store.put(item, Date.now(), false);
  expect(
    (await store.browse([a], { ...catalogScope(settings), kind: 'movie' }))
      .total
  ).toBe(1);
  expect(
    (await store.browse([a], { ...catalogScope(settings), kind: 'tv' })).total
  ).toBe(0);
});

test('validates empty names, category cycles, duplicate bindings and missing destinations', () => {
  const settings = mergeCatalogCategories(base(), snapshots);
  expect(() => parseCatalogSettings(settings)).not.toThrow();
  const copy = () => JSON.parse(JSON.stringify(settings));
  const blank = copy();
  blank.Categories[0].name = ' ';
  expect(() => parseCatalogSettings(blank)).toThrow();
  const cycle = copy();
  cycle.Categories[0].parentId = cycle.Categories[1].id;
  expect(() => parseCatalogSettings(cycle)).toThrow('循环');
  const duplicate = copy();
  duplicate.CategoryBindings.push(duplicate.CategoryBindings[0]);
  expect(() => parseCatalogSettings(duplicate)).toThrow('只能绑定一个');
  const missing = copy();
  missing.CategoryBindings[0].categoryId = 'missing';
  expect(() => parseCatalogSettings(missing)).toThrow('不存在');
});

test('large category trees stay below 100 bound parameters per SQL statement', async () => {
  let maximum = 0;
  const adapter = new SQLiteAdapter(db);
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
  const largeStore = new CatalogStore(adapter);
  await largeStore.put(normalize(), Date.now(), false);
  const config: CatalogCategoryConfig = {
    Categories: [
      { id: 'root', name: '影片', kind: 'movie', parentId: '', enabled: true },
      ...Array.from({ length: 150 }, (_, index) => ({
        id: `child_${index}`,
        name: `类型${index}`,
        kind: 'movie' as const,
        parentId: 'root',
        enabled: true,
      })),
    ],
    CategoryBindings: [{ sourceKey: 'a', typeId: '8', categoryId: 'child_0' }],
  };
  expect(
    (
      await largeStore.browse([a], {
        categoryConfig: config,
        categoryId: 'root',
      })
    ).total
  ).toBe(1);
  expect(maximum).toBeLessThanOrEqual(100);
});
