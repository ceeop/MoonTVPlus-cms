/** @jest-environment node */

import type { NextRequest } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { fetchCmsCategories } from '@/lib/catalog/cms-categories';
import { catalogSettings } from '@/lib/catalog/model';
import { getCatalogStore } from '@/lib/catalog/store';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

import { POST } from './route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status: number }) => ({
      status: init?.status || 200,
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  setCachedConfig: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: { saveAdminConfig: jest.fn(), getUserInfoV2: jest.fn() },
}));
jest.mock('@/lib/catalog/store', () => ({ getCatalogStore: jest.fn() }));
jest.mock('@/lib/catalog/collector', () => ({ collectCatalog: jest.fn() }));
jest.mock('@/lib/catalog/cms-categories', () => ({
  ...jest.requireActual('@/lib/catalog/cms-categories'),
  fetchCmsCategories: jest.fn(),
}));

let config: AdminConfig;
const release = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  config = {
    SourceConfig: [
      { key: 'a', name: '源 A', api: 'https://a.invalid/api' },
      { key: 'b', name: '源 B', api: 'https://b.invalid/api' },
    ],
    CatalogConfig: {
      ...catalogSettings({}),
      Enabled: true,
      SourceKeys: ['a', 'b'],
      DefaultSourceKey: 'a',
      Categories: [
        {
          id: 'movie',
          name: '电影',
          kind: 'movie',
          parentId: '',
          enabled: true,
        },
      ],
      CategoryBindings: [{ sourceKey: 'a', typeId: '1', categoryId: 'movie' }],
    },
  } as unknown as AdminConfig;
  (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
    username: 'test-admin',
  });
  (db.getUserInfoV2 as jest.Mock).mockResolvedValue({
    role: 'admin',
    banned: false,
  });
  (getConfig as jest.Mock).mockImplementation(async () => config);
  (getCatalogStore as jest.Mock).mockReturnValue({
    acquireSettingsLock: async () => true,
    releaseSettingsLock: release,
    init: async () => undefined,
  });
  (fetchCmsCategories as jest.Mock).mockResolvedValue({
    sourceKey: 'b',
    categories: [
      { id: '90', name: '电影', parentId: '' },
      { id: '91', name: '动作片', parentId: '90' },
    ],
  });
});

const save = (settings: unknown) =>
  POST({
    json: async () => ({ action: 'save', scope: 'collection', settings }),
  } as NextRequest);

test('saving a different default source imports its categories before validating and persists the new configuration', async () => {
  const response = await save({
    ...config.CatalogConfig,
    DefaultSourceKey: 'b',
    SourceKeys: ['b'],
    CollectionCategoryIds: ['movie'],
  });
  expect(response.status).toBe(200);
  const { settings } = await response.json();
  expect(settings.DefaultSourceKey).toBe('b');
  expect(settings.Categories).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: '动作片', parentId: 'movie' }),
    ])
  );
  expect(settings.CategoryBindings).toContainEqual({
    sourceKey: 'b',
    typeId: '90',
    categoryId: 'movie',
  });
  expect(settings.CollectionCategoryIds).toEqual(['movie']);
  expect(db.saveAdminConfig).toHaveBeenCalledWith(
    expect.objectContaining({ CatalogConfig: settings })
  );
  expect(fetchCmsCategories).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
});

test('a failed default source sync leaves the persisted settings untouched and releases the settings lock', async () => {
  (fetchCmsCategories as jest.Mock).mockRejectedValue(new Error('timeout'));
  const response = await save({
    ...config.CatalogConfig,
    DefaultSourceKey: 'b',
  });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain('timeout');
  expect(config.CatalogConfig?.DefaultSourceKey).toBe('a');
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledTimes(1);
});

test('an interval-only save does not refetch categories or overwrite the current taxonomy', async () => {
  const response = await save({
    ...config.CatalogConfig,
    IntervalMinutes: 60,
    Categories: [],
  });
  expect(response.status).toBe(200);
  expect((await response.json()).settings.Categories).toEqual(
    config.CatalogConfig?.Categories
  );
  expect(fetchCmsCategories).not.toHaveBeenCalled();
});

test('cleanup preferences are saved without refetching source categories', async () => {
  const response = await save({
    ...config.CatalogConfig,
    CleanupEnabled: false,
    RetentionMonths: 12,
  });
  expect(response.status).toBe(200);
  const { settings } = await response.json();
  expect(settings).toEqual(
    expect.objectContaining({ CleanupEnabled: false, RetentionMonths: 12 })
  );
  expect(db.saveAdminConfig).toHaveBeenCalledWith(
    expect.objectContaining({ CatalogConfig: settings })
  );
  expect(fetchCmsCategories).not.toHaveBeenCalled();
});

test('manual cleanup uses the saved retention period while scheduled cleanup is disabled', async () => {
  config.CatalogConfig = {
    ...catalogSettings(config),
    CleanupEnabled: false,
    RetentionMonths: 3,
  };
  const cleanupExpired = jest.fn().mockResolvedValue({
    lastRun: Date.now(),
    resources: 2,
    works: 1,
    posters: 1,
  });
  (getCatalogStore as jest.Mock).mockReturnValue({ cleanupExpired });
  const response = await POST({
    json: async () => ({ action: 'cleanup', settings: { RetentionMonths: 1 } }),
  } as NextRequest);
  expect(response.status).toBe(200);
  expect(cleanupExpired).toHaveBeenCalledWith(expect.any(Number), true, 3);
});

test('non-admin requests cannot change the default source', async () => {
  (getAuthInfoFromCookie as jest.Mock).mockReturnValue(null);
  expect(
    (await save({ ...config.CatalogConfig, DefaultSourceKey: 'b' })).status
  ).toBe(403);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

test('switching to a different taxonomy preserves an explicit collection scope until it is updated', async () => {
  (fetchCmsCategories as jest.Mock).mockResolvedValue({
    sourceKey: 'b',
    categories: [{ id: '7', name: '动画片', parentId: '' }],
  });
  const response = await save({
    ...config.CatalogConfig,
    DefaultSourceKey: 'b',
    SourceKeys: ['b'],
    CollectionCategoryIds: ['movie'],
  });
  expect(response.status).toBe(200);
  const { settings } = await response.json();
  expect(settings.Enabled).toBe(true);
  expect(settings.CollectionCategoryIds).toEqual(['movie']);
  expect(settings.Categories).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: '动画片' })])
  );
});
