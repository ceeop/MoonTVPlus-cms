/** @jest-environment node */

import type { NextRequest } from 'next/server';
import { getConfig } from '@/lib/config';

import { GET } from './route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown) => ({ status: 200, json: async () => body }),
  },
}));
jest.mock('@/lib/config', () => ({
  getAvailableApiSites: async () => [
    { key: 'main', name: '主源', api: 'https://cms.test/api' },
  ],
  getConfig: jest.fn(),
}));
jest.mock('@/lib/tvbox/access', () => ({
  authorizeTVBox: async () => ({ global: true }),
  TVBoxAccessError: class extends Error {},
  tvboxBaseUrl: () => 'http://192.168.1.10:3000',
}));
jest.mock('@/lib/live', () => ({ getCachedLiveChannels: jest.fn() }));
jest.mock('@/lib/permissions', () => ({ hasFeaturePermission: jest.fn() }));
jest.mock('@/lib/emby-manager', () => ({
  embyManager: { getEnabledSources: async () => [] },
}));

const siteConfig = {
  CatalogConfig: { Enabled: true },
  TVBoxConfig: {
    CatalogEnabled: true,
    Subscriptions: [
      {
        id: 'external',
        name: '外部订阅',
        enabled: true,
        document: {
          sites: [
            {
              key: 'cms',
              name: '外部 CMS',
              api: 'https://external.test/cms',
              type: 1,
            },
          ],
        },
      },
    ],
  },
};
beforeEach(() => {
  (getConfig as jest.Mock).mockResolvedValue({
    ...siteConfig,
    SiteConfig: { M3u8Only: false },
  });
});

const get = (query = '') =>
  GET({
    nextUrl: new URL(
      'http://localhost/api/tvbox/subscribe?token=test-token&' + query
    ),
  } as unknown as NextRequest);

test('the global M3U8 policy routes built-in and external CMS through the server without changing subscription parameters', async () => {
  (getConfig as jest.Mock).mockResolvedValue({
    ...siteConfig,
    SiteConfig: { M3u8Only: true },
  });
  const data = await (await get('m3u8Only=false')).json();
  const catalog = data.sites.find(
    (site: { key: string }) => site.key === 'moontv_catalog'
  );
  const main = data.sites.find((site: { key: string }) => site.key === 'main');
  const external = data.sites.find(
    (site: { name: string }) => site.name === '外部 CMS'
  );
  for (const site of [catalog, main, external]) {
    expect(new URL(site.api).searchParams.has('m3u8Only')).toBe(false);
    expect(new URL(site.api).searchParams.get('adFilter')).not.toBe('true');
  }
  expect(new URL(main.api).pathname).toBe(
    '/api/tvbox/source/test-token/builtin/main'
  );
  expect(new URL(external.api).pathname).toContain('/api/tvbox/source/');
});

test('individual CMS addresses stay identical when the global filter changes', async () => {
  const data = await (await get('m3u8Only=true')).json();
  const main = data.sites.find((site: { key: string }) => site.key === 'main');
  const external = data.sites.find(
    (site: { name: string }) => site.name === '外部 CMS'
  );
  expect(new URL(main.api).pathname).toBe(
    '/api/tvbox/source/test-token/builtin/main'
  );
  expect(new URL(external.api).pathname).toBe(
    '/api/tvbox/source/test-token/external/cms'
  );
  (getConfig as jest.Mock).mockResolvedValue({
    ...siteConfig,
    SiteConfig: { M3u8Only: true },
  });
  const enabled = await (await get()).json();
  expect(enabled.sites).toContainEqual(main);
  expect(enabled.sites).toContainEqual(external);
});
