/** @jest-environment node */

import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

import { safeFetch } from '@/lib/safe-http';

import {
  localizeTVBoxDocument,
  mirrorTVBoxAssets,
  readTVBoxAsset,
} from './assets';
import type { TVBoxSubscription } from './types';

jest.mock('@/lib/safe-http', () => ({ safeFetch: jest.fn() }));
let root: string;
const environment = { ...process.env };
beforeEach(async () => {
  jest.clearAllMocks();
  root = await mkdtemp(path.join(os.tmpdir(), 'tvbox-assets-test-'));
  process.env.TVBOX_ASSET_DIR = root;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  process.env = { ...environment };
});
const response = (bytes: Buffer, url: string) => ({
  ok: true,
  status: 200,
  url,
  headers: { get: () => 'application/octet-stream' },
  arrayBuffer: async () => bytes,
});

test('stores shared jars once and preserves transport bytes and md5 suffixes', async () => {
  const jar = 'https://example.test/wrapped.jpg';
  const bytes = Buffer.from([255, 216, 255, 0, 1, 2, 3]);
  (safeFetch as jest.Mock).mockResolvedValue(response(bytes, jar));
  const document = {
    spider: jar + ';md5;keep',
    sites: [
      { key: 'a', name: 'A', api: 'csp_A', type: 3, jar: jar + ';md5;keep' },
      { key: 'b', name: 'B', api: 'csp_B', type: 3, jar: jar + ';md5;keep' },
    ],
  };
  const mirrored = await mirrorTVBoxAssets(document);
  expect(safeFetch).toHaveBeenCalledTimes(1);
  expect(mirrored.assets).toHaveLength(1);
  const subscription: TVBoxSubscription = {
    id: 'a',
    name: 'A',
    url: 'https://example.test/tv',
    enabled: true,
    updatedAt: 1,
    document,
    ...mirrored,
  };
  const local = localizeTVBoxDocument(
    subscription,
    'http://192.168.1.10:3000',
    'token'
  );
  expect(local.spider).toMatch(
    /^http:\/\/192\.168\.1\.10:3000\/api\/tvbox\/assets\/token\/[a-f0-9]{64}\/wrapped.jpg;md5;keep$/
  );
  expect(
    await readTVBoxAsset(
      mirrored.assets[0],
      subscription,
      'http://localhost',
      'token'
    )
  ).toEqual(bytes);
});

test('downloads static script imports and rewrites them to authenticated local resources', async () => {
  const main = 'https://example.test/scripts/main.js',
    child = 'https://example.test/scripts/child.js';
  (safeFetch as jest.Mock).mockImplementation(async (url: string) =>
    response(
      Buffer.from(
        url === main
          ? "import {value} from './child.js'; export default value;"
          : 'export const value = 42;'
      ),
      url
    )
  );
  const document = { sites: [{ key: 'a', name: 'A', type: 3, api: main }] };
  const mirrored = await mirrorTVBoxAssets(document);
  expect(mirrored.assets).toHaveLength(2);
  expect(mirrored.assets.map((asset) => asset.url)).toContain(child);
  const subscription: TVBoxSubscription = {
    id: 'a',
    name: 'A',
    url: 'https://example.test/tv',
    enabled: true,
    updatedAt: 1,
    document,
    ...mirrored,
  };
  const asset = mirrored.assets.find((entry) => entry.url === main);
  if (!asset) throw new Error('Main script missing');
  const source = (
    await readTVBoxAsset(asset, subscription, 'http://localhost', 'token')
  ).toString();
  expect(source).toContain('http://localhost/api/tvbox/assets/token/');
  expect(source).not.toContain('./child.js');
});

test('keeps a previously downloaded file when an upstream refresh fails', async () => {
  const document = {
    spider: 'https://example.test/a.jar',
    sites: [{ key: 'a', name: 'A', type: 3, api: 'csp_A' }],
  };
  (safeFetch as jest.Mock).mockResolvedValue(
    response(Buffer.from('jar-data'), document.spider)
  );
  const first = await mirrorTVBoxAssets(document);
  (safeFetch as jest.Mock).mockRejectedValue(new Error('network failure'));
  const second = await mirrorTVBoxAssets(
    document,
    first.assets,
    undefined,
    true
  );
  expect(second.assets).toEqual(first.assets);
  expect(second.assetErrors).toHaveLength(1);
});
