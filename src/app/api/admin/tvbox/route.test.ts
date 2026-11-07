/** @jest-environment node */

import type { NextRequest } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { mirrorTVBoxAssets } from '@/lib/tvbox/assets';
import { fetchTVBoxSubscription } from '@/lib/tvbox/subscriptions';

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
  db: { getUserInfoV2: jest.fn(), saveAdminConfig: jest.fn() },
}));
jest.mock('@/lib/tvbox/assets', () => ({ mirrorTVBoxAssets: jest.fn() }));
jest.mock('@/lib/tvbox/subscriptions', () => ({
  ...jest.requireActual('@/lib/tvbox/subscriptions'),
  fetchTVBoxSubscription: jest.fn(),
}));

let config: AdminConfig;
const document = {
  spider: 'https://external.test/spider.jar',
  sites: [
    { key: 'cms', name: 'CMS', type: 1, api: 'https://external.test/cms' },
    {
      key: 'jar',
      name: 'Jar',
      type: 3,
      api: 'csp_A',
      jar: 'https://external.test/spider.jar',
    },
  ],
};
beforeEach(() => {
  jest.clearAllMocks();
  config = {
    SourceConfig: [],
    TVBoxConfig: {
      CatalogEnabled: true,
      Subscriptions: [
        {
          id: 'sample',
          name: 'Example',
          url: 'https://external.test/tv',
          enabled: true,
          document,
          updatedAt: 1,
        },
      ],
    },
  } as unknown as AdminConfig;
  (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
    username: 'tvbox-admin',
  });
  (db.getUserInfoV2 as jest.Mock).mockResolvedValue({
    role: 'admin',
    banned: false,
  });
  (getConfig as jest.Mock).mockImplementation(async () => config);
  (fetchTVBoxSubscription as jest.Mock).mockResolvedValue(document);
  (mirrorTVBoxAssets as jest.Mock).mockResolvedValue({
    assets: [],
    assetErrors: [],
    assetsUpdatedAt: 2,
  });
});
const post = (body: Record<string, unknown>) =>
  POST({ json: async () => body } as NextRequest);

test('only administrators may import or change subscriptions', async () => {
  (db.getUserInfoV2 as jest.Mock).mockResolvedValue({
    role: 'user',
    banned: false,
  });
  expect(
    (await post({ action: 'add', name: 'A', url: 'https://a.test/tv' })).status
  ).toBe(403);
  expect(fetchTVBoxSubscription).not.toHaveBeenCalled();
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

test('failed refresh leaves the saved document and site selection unchanged', async () => {
  const before = JSON.stringify(config);
  (fetchTVBoxSubscription as jest.Mock).mockRejectedValue(new Error('timeout'));
  const response = await post({ action: 'refresh', id: 'sample' });
  expect(response.status).toBe(400);
  expect(JSON.stringify(config)).toBe(before);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

test('updates retain explicit selections and discard only keys removed by the upstream', async () => {
  const [subscription] = config.TVBoxConfig?.Subscriptions || [];
  subscription.selectedSiteKeys = ['cms', 'removed'];
  const response = await post({ action: 'refresh', id: 'sample' });
  const data = await response.json();
  expect(data.error).toBeUndefined();
  expect(response.status).toBe(200);
  expect(data.settings.Subscriptions[0].selectedSiteKeys).toEqual(['cms']);
  expect(subscription.updatedAt).toBe(1);
});

test('imports selected standard CMS sources while preserving the existing catalog settings', async () => {
  config.CatalogConfig = {
    Enabled: true,
    SourceKeys: ['original'],
    IntervalMinutes: 30,
  };
  const response = await post({ action: 'import-cms', id: 'sample' });
  expect(response.status).toBe(200);
  const saved = (db.saveAdminConfig as jest.Mock).mock.calls[0][0];
  expect(saved.SourceConfig).toHaveLength(1);
  expect(saved.SourceConfig[0]).toMatchObject({
    api: 'https://external.test/cms',
    from: 'custom',
  });
  expect(saved.CatalogConfig).toEqual(config.CatalogConfig);
  expect(config.SourceConfig).toHaveLength(0);
});

test('adds fetched subscriptions without losing changes saved while the fetch was running', async () => {
  (fetchTVBoxSubscription as jest.Mock).mockImplementation(async () => {
    config.SourceConfig = [
      {
        key: 'new-source',
        name: 'New',
        api: 'https://new.test/cms',
        from: 'custom',
      },
    ];
    return document;
  });
  const response = await post({
    action: 'add',
    name: 'Second',
    url: 'https://second.test/tv',
  });
  expect(response.status).toBe(200);
  const saved = (db.saveAdminConfig as jest.Mock).mock.calls[0][0];
  expect(saved.SourceConfig[0].key).toBe('new-source');
  expect(saved.TVBoxConfig.Subscriptions).toHaveLength(2);
});

test('persists the cloud filter and local file preferences independently', async () => {
  const response = await post({
    action: 'options',
    FilterCloudDrive: false,
    LocalAssetsEnabled: true,
  });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.settings).toMatchObject({
    FilterCloudDrive: false,
    LocalAssetsEnabled: true,
  });
  expect(data.settings.Subscriptions).toHaveLength(1);
});

test('downloading assets records partial failures without replacing the subscription document', async () => {
  (mirrorTVBoxAssets as jest.Mock).mockResolvedValue({
    assets: [],
    assetErrors: ['https://external.test/spider.jar：HTTP 503'],
    assetsUpdatedAt: 2,
  });
  const response = await post({ action: 'mirror', id: 'sample' });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.settings.Subscriptions[0].document).toEqual(document);
  expect(data.message).toContain('1 个下载失败');
});
