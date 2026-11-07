/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

import { POST } from './route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status || 200,
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: () => ({ username: 'site-admin' }),
}));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/db', () => ({
  db: {
    getUserInfoV2: async () => ({ role: 'admin' }),
    saveAdminConfig: jest.fn(),
  },
}));

const site = {
  SiteName: 'MoonTV',
  Announcement: '',
  SearchDownstreamMaxPage: 1,
  SiteInterfaceCacheTime: 7200,
  DoubanProxyType: '',
  DoubanProxy: '',
  DoubanImageProxyType: '',
  DoubanImageProxy: '',
  DisableYellowFilter: false,
  FluidSearch: true,
  DanmakuApiBase: '',
  DanmakuApiToken: '',
  EnableComments: false,
};
const originalStorage = process.env.NEXT_PUBLIC_STORAGE_TYPE;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'postgres';
  (getConfig as jest.Mock).mockResolvedValue({
    SiteConfig: { ...site, M3u8Only: false },
  });
});
afterAll(() => {
  if (originalStorage === undefined)
    delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
  else process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorage;
});
const save = (value: object) =>
  POST({ json: async () => ({ ...site, ...value }) } as unknown as NextRequest);

test('the administrator saves one global M3U8 policy', async () => {
  expect((await save({ M3u8Only: true })).status).toBe(200);
  expect(
    (db.saveAdminConfig as jest.Mock).mock.calls[0][0].SiteConfig.M3u8Only
  ).toBe(true);
});

test('other settings forms preserve the existing format policy when omitting it', async () => {
  (getConfig as jest.Mock).mockResolvedValue({
    SiteConfig: { ...site, M3u8Only: true },
  });
  expect((await save({})).status).toBe(200);
  expect(
    (db.saveAdminConfig as jest.Mock).mock.calls[0][0].SiteConfig.M3u8Only
  ).toBe(true);
});

test('a non-boolean global policy is rejected before saving', async () => {
  expect((await save({ M3u8Only: 'true' })).status).toBe(400);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});
