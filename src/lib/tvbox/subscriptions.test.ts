/** @jest-environment node */

import {
  decodeTVBoxDocument,
  isCMSImportable,
  mergeTVBoxSubscriptions,
  normalizeTVBoxDocument,
} from './subscriptions';
import type { TVBoxSettings } from './types';

jest.mock('@/lib/safe-http', () => ({ safeFetch: jest.fn() }));

test('decodes image-wrapped Base64 configurations and tolerates comments and trailing commas', () => {
  const json = `{
    // a configuration URL can include // and commas inside strings
    "spider": "./spider.jar;md5;abc",
    "sites": [{"key":"a","name":"Source A","type":3,"api":"csp_A","ext":"https://example.test/a,}",}, /* trailing comment */ ],
  }`;
  const bytes = Buffer.concat([
    Buffer.from([255, 216, 255, 224]),
    Buffer.from('1234abcd**' + Buffer.from(json).toString('base64')),
  ]);
  const result = normalizeTVBoxDocument(
    decodeTVBoxDocument(bytes),
    'https://example.test/config/tv'
  );
  expect(result.spider).toBe('https://example.test/config/spider.jar;md5;abc');
  expect(result.sites[0]).toMatchObject({
    api: 'csp_A',
    jar: result.spider,
    ext: 'https://example.test/a,}',
  });
});

test('preserves site-specific jars and resolves relative scripts, ext objects and live resources', () => {
  const document = normalizeTVBoxDocument(
    {
      spider: '../global.jar',
      sites: [
        {
          key: 'a',
          type: 3,
          api: './a.js',
          jar: './own.jar',
          ext: { rules: '../rules.json', token: 'opaque-string' },
        },
      ],
      lives: [{ name: 'Live', url: './live.m3u' }],
    },
    'https://example.test/path/config.json'
  );
  expect(document.sites[0]).toMatchObject({
    api: 'https://example.test/path/a.js',
    jar: 'https://example.test/path/own.jar',
    ext: { rules: 'https://example.test/rules.json', token: 'opaque-string' },
  });
  expect(document.lives).toEqual([
    { name: 'Live', url: 'https://example.test/path/live.m3u' },
  ]);
});

test('merges selected sites without replacing their jars or overwriting existing site keys', () => {
  const document = normalizeTVBoxDocument(
    {
      spider: './a.jar',
      sites: [
        { key: 'same', type: 3, api: 'csp_A' },
        { key: 'unselected', type: 1, api: 'https://example.test/cms' },
      ],
      flags: ['direct'],
      parses: [{ name: 'parser', type: 1, url: 'https://example.test/parse' }],
    },
    'https://a.test/tv'
  );
  const settings: TVBoxSettings = {
    CatalogEnabled: true,
    Subscriptions: [
      {
        id: 'first',
        name: 'A',
        url: 'https://a.test/tv',
        enabled: true,
        updatedAt: 1,
        selectedSiteKeys: ['same'],
        document,
      },
      {
        id: 'second',
        name: 'B',
        url: 'https://b.test/tv',
        enabled: true,
        updatedAt: 1,
        document: normalizeTVBoxDocument(
          {
            spider: './b.jar',
            sites: [{ key: 'same', type: 3, api: 'csp_B' }],
            flags: ['direct'],
          },
          'https://b.test/tv'
        ),
      },
      {
        id: 'disabled',
        name: 'C',
        url: 'https://c.test/tv',
        enabled: false,
        updatedAt: 1,
        document,
      },
    ],
  };
  const result = mergeTVBoxSubscriptions(settings, ['same']);
  expect(result.sites.map((site) => site.key)).toEqual([
    'first:same',
    'second:same',
  ]);
  expect(result.sites.map((site) => site.jar)).toEqual([
    'https://a.test/a.jar',
    'https://b.test/b.jar',
  ]);
  expect(result.flags).toEqual(['direct']);
  expect(result.parses).toHaveLength(1);
  expect(document.sites[0].key).toBe('same');
});

test('rejects HTML, ambiguous depot links and duplicate site keys', () => {
  expect(() => decodeTVBoxDocument('<html>error</html>')).toThrow('JSON');
  expect(() =>
    normalizeTVBoxDocument(
      { urls: [{ url: 'https://example.test/a' }] },
      'https://example.test/tv'
    )
  ).toThrow('具体线路');
  expect(() =>
    normalizeTVBoxDocument(
      {
        sites: [
          { key: 'a', api: 'csp_A', type: 3 },
          { key: 'a', api: 'csp_B', type: 3 },
        ],
      },
      'https://example.test/tv'
    )
  ).toThrow('重复');
  expect(
    isCMSImportable({
      key: 'a',
      name: 'A',
      type: 1,
      api: 'https://example.test/cms',
    })
  ).toBe(true);
  expect(isCMSImportable({ key: 'a', name: 'A', type: 3, api: 'csp_A' })).toBe(
    false
  );
});
