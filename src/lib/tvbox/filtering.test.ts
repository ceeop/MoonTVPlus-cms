/** @jest-environment node */

import { cloudDriveReason } from './cloud-filter';
import {
  filterTVBoxCMS,
  isTVBoxM3u8Url,
  processTVBoxPlayLines,
  proxyTVBoxPlayUrls,
} from './cms';
import { exportTVBoxSubscriptions } from './export';
import { TVBOX_HLS_PATH, tvboxHlsParams } from './hls';
import type { TVBoxSettings } from './types';

test('cloud filtering covers config, search and playback sites while retaining ordinary shared-ext sites', () => {
  for (const site of [
    { key: 'MDrive', name: '我的云盘配置', api: 'csp_MyDriveGuard' },
    { key: 'ZPan', name: '盘搜四盘', api: 'csp_S_zpsGuard' },
    { key: 'seed', name: '聚剧', api: 'csp_SeedhubGuard' },
    { key: 'play', name: '玩偶哥哥', api: 'csp_WoGGGuard' },
  ])
    expect(cloudDriveReason({ ...site, type: 3 })).toBeTruthy();
  expect(
    cloudDriveReason({
      key: 'Libvio',
      name: '立播',
      api: 'csp_LibvioGuard',
      type: 3,
      ext: { 'Cloud-drive': 'tvfan/Cloud-drive.txt' },
    })
  ).toBeNull();
});

test('content filtering and m3u8 proxying can be enabled independently', () => {
  const input = {
    page: 2,
    pagecount: 5,
    total: 100,
    list: [
      {
        vod_name: '普通电影',
        vod_play_url: '正片$https://video.test/a.m3u8?signature=keep',
      },
      { vod_name: '色情片', vod_play_url: '正片$https://video.test/b.mp4' },
    ],
  };
  const filtered = filterTVBoxCMS(
    input,
    'http://192.168.1.10:3000',
    false,
    true
  ) as typeof input;
  expect(filtered.list).toHaveLength(1);
  expect(filtered.list[0].vod_play_url).toBe(input.list[0].vod_play_url);
  expect(filtered.pagecount).toBe(5);
  const proxied = filterTVBoxCMS(
    input,
    'http://192.168.1.10:3000',
    true,
    false
  ) as typeof input;
  expect(proxied.list).toHaveLength(2);
  expect(proxied.list[0].vod_play_url).toContain(
    'http://192.168.1.10:3000/api/proxy-m3u8/playlist.m3u8?id='
  );
  expect(proxied.list[1].vod_play_url).toBe(input.list[1].vod_play_url);
  expect(input.list).toHaveLength(2);
});

test('external CMS sites get a filtering endpoint while jars retain their client API', () => {
  const settings: TVBoxSettings = {
    CatalogEnabled: true,
    FilterCloudDrive: true,
    Subscriptions: [
      {
        id: 'sample',
        name: 'Sample',
        url: 'https://example.test/tv',
        enabled: true,
        updatedAt: 1,
        document: {
          sites: [
            {
              key: 'cms',
              name: 'CMS',
              api: 'https://example.test/cms',
              type: 1,
            },
            { key: 'jar', name: 'JAR', api: 'csp_Direct', type: 3 },
            { key: 'pan', name: '网盘配置', api: 'csp_MyDrive', type: 3 },
          ],
        },
      },
    ],
  };
  const filtered = exportTVBoxSubscriptions(
    settings,
    [],
    'http://localhost:3000',
    'token',
    true,
    true
  );
  expect(filtered.sites).toHaveLength(2);
  expect(filtered.sites[0].api).toContain(
    '/api/tvbox/source/token/sample/cms?adFilter=true&yellowFilter=true'
  );
  expect(filtered.sites[1].api).toBe('csp_Direct');
  const all = exportTVBoxSubscriptions(
    { ...settings, FilterCloudDrive: false },
    [],
    'http://localhost:3000',
    'token',
    false,
    false
  );
  expect(all.sites).toHaveLength(3);
  expect(new URL(all.sites[0].api).pathname).toBe(
    '/api/tvbox/source/token/sample/cms'
  );
  expect(new URL(all.sites[0].api).searchParams.get('adFilter')).toBe('false');
  const m3u8 = exportTVBoxSubscriptions(
    settings,
    [],
    'http://localhost:3000',
    'token',
    false,
    false,
    true
  );
  expect(m3u8.sites).toHaveLength(1);
  expect(m3u8.sites[0].type).toBe(1);
  expect(new URL(m3u8.sites[0].api).searchParams.has('m3u8Only')).toBe(false);
});

test('preserves source-specific rules, playback-line boundaries, signed URLs and player suffixes', () => {
  const first = 'https://video.test/a.M3U8?sig=a%2Bb&expires=1';
  const input = `第一集$${first}$extra#第二集$https://video.test/a.mp4$$$正片$https://video.test/b.m3u8`;
  const result = proxyTVBoxPlayUrls(
    input,
    'hls-a$$$hls-b',
    'http://localhost:3000'
  );
  const lines = result.split('$$$');
  const firstEpisode = lines[0].split('#')[0].split('$');
  const proxy = new URL(firstEpisode[1]);
  expect(proxy.pathname).toBe(TVBOX_HLS_PATH);
  expect(proxy.href).not.toMatch(/=http|rl=/);
  const params = tvboxHlsParams(proxy.searchParams.get('id'));
  expect(params?.get('url')).toBe(first);
  expect(params?.get('source')).toBe('hls-a');
  expect(firstEpisode[2]).toBe('extra');
  expect(lines[0]).toContain('第二集$https://video.test/a.mp4');
  expect(
    tvboxHlsParams(
      new URL(lines[1].slice(lines[1].indexOf('$') + 1)).searchParams.get('id')
    )?.get('source')
  ).toBe('hls-b');
  expect(
    proxyTVBoxPlayUrls(result, 'hls-a$$$hls-b', 'http://localhost:3000')
  ).toBe(result);
  const withKey = proxyTVBoxPlayUrls(
    input,
    'hls-a$$$hls-b',
    'http://localhost:3000',
    'configured-key'
  );
  expect(
    tvboxHlsParams(new URL(withKey.split('$')[1]).searchParams.get('id'))?.get(
      'source'
    )
  ).toBe('configured-key');
});

test('M3U8-only selection removes parser and file lines while keeping names, titles and signatures aligned', () => {
  const share = '第四集$https://video.test/share/item';
  const media = 'https://video.test/episode4.M3U8?sign=a%2Bb&expires=1';
  const input = `${share}$$$第四集$${media}#第五集$https://video.test/e5.mp4$$$第四集$https://video.test/file.mp4`;
  const result = processTVBoxPlayLines(
    input,
    'web$$$hls$$$file',
    'http://localhost:3000',
    { m3u8Only: true }
  );
  expect(result.vod_play_from).toBe('hls');
  expect(result.vod_play_url).toBe(`第四集$${media}`);
  const off = processTVBoxPlayLines(
    input,
    'web$$$hls$$$file',
    'http://localhost:3000'
  );
  expect(off.vod_play_from).toBe('web$$$hls$$$file');
  expect(off.vod_play_url).toBe(input);
  const proxied = processTVBoxPlayLines(
    input,
    'web$$$hls$$$file',
    'http://localhost:3000',
    { m3u8Only: true, adFilter: true, source: 'cms' }
  );
  expect(proxied.vod_play_from).toBe('hls');
  expect(
    tvboxHlsParams(
      new URL(proxied.vod_play_url.split('$')[1]).searchParams.get('id')
    )?.get('url')
  ).toBe(media);
});

test('upgrades old same-site playlist proxy links without nesting them', () => {
  const origin = 'https://site.example';
  const target = 'https://upstream.example/index.m3u8?auth=x%2By';
  const legacy = new URL('/api/proxy-m3u8', origin);
  legacy.searchParams.set('url', target);
  legacy.searchParams.set('source', 'original');
  legacy.searchParams.set('proxySegments', 'true');
  const proxied = new URL(proxyTVBoxPlayUrls(legacy.href, '', origin, 'cms'));
  const params = tvboxHlsParams(proxied.searchParams.get('id'));
  expect(params?.get('url')).toBe(target);
  expect(params?.get('source')).toBe('original');
  expect(params?.get('proxySegments')).toBe('true');
});

test('M3U8-only selection hides explicit unplayable details and retains list metadata without playback URLs', () => {
  const input = {
    total: 20,
    pagecount: 2,
    list: [
      { vod_name: '网页片', vod_play_url: '正片$https://video.test/watch' },
      { vod_name: '直链片', vod_play_url: '第4集$https://video.test/a.m3u8' },
      { vod_name: '列表海报' },
    ],
  };
  const result = filterTVBoxCMS(
    input,
    'http://localhost:3000',
    false,
    false,
    '',
    true
  ) as typeof input;
  expect(result.list.map((item) => item.vod_name)).toEqual([
    '直链片',
    '列表海报',
  ]);
  expect(result.list[0].vod_play_url).toBe('第4集$https://video.test/a.m3u8');
  expect(result.pagecount).toBe(2);
  expect(input.list).toHaveLength(3);
});

test('M3U8 recognition checks actual URL paths and follows existing playlist proxy URLs', () => {
  expect(isTVBoxM3u8Url('https://video.test/a.M3U8?token=keep')).toBe(true);
  expect(isTVBoxM3u8Url('https://video.test/watch?next=a.m3u8')).toBe(false);
  expect(isTVBoxM3u8Url('https://video.test/a.m3u8.mp4')).toBe(false);
  const proxy =
    'https://app.test/api/proxy-m3u8?' +
    new URLSearchParams({ url: 'https://video.test/a.m3u8?sign=keep' });
  expect(isTVBoxM3u8Url(proxy)).toBe(true);
});
