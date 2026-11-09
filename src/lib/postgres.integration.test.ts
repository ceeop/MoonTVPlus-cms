/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-var-requires */

import { randomBytes } from 'crypto';
import { Pool } from 'pg';

import { normalizeCmsItem } from './catalog/model';
import { CatalogStore } from './catalog/store';
import { PostgresStorage } from './postgres.db';
import { PostgresAdapter } from './postgres-adapter';
import { closePostgresPool, getPostgresPool } from './postgres-pool';
import type { PlayRecord } from './types';

jest.mock('./notification-dispatch', () => ({
  dispatchNotificationChannels: jest.fn(),
}));

const { initPostgresDatabase } = require('../../scripts/init-postgres');
const describePostgres = process.env.POSTGRES_TEST_URL
  ? describe
  : describe.skip;

// Each run uses a temporary schema; never initialize or clear the application's schema.
describePostgres('PostgreSQL storage integration', () => {
  const schema = `moontv_test_${randomBytes(8).toString('hex')}`;
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    USERNAME: process.env.USERNAME,
    PASSWORD: process.env.PASSWORD,
  };
  let admin: Pool;
  let adapter: PostgresAdapter;
  let storage: PostgresStorage;
  const record: PlayRecord = {
    title: '测试剧集',
    source_name: '测试源',
    cover: '',
    year: '2026',
    index: 1,
    total_episodes: 12,
    play_time: 120,
    total_time: 2400,
    save_time: 1793836800123,
    search_title: '测试剧集',
    is_anime: true,
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.POSTGRES_TEST_URL });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(process.env.POSTGRES_TEST_URL!);
    const options = url.searchParams.get('options') || '';
    url.searchParams.set(
      'options',
      `${options} -c search_path=${schema}`.trim()
    );
    process.env.DATABASE_URL = url.toString();
    process.env.USERNAME = 'pg-test-admin';
    process.env.PASSWORD = 'pg-test-password';
    await initPostgresDatabase();
    adapter = new PostgresAdapter();
    storage = new PostgresStorage(adapter);
    await storage.createUserV2('reader', 'reader-password', 'user', ['vip']);
  }, 30000);

  afterAll(async () => {
    await closePostgresPool();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('initializes all migrations and preserves existing data on repeated initialization', async () => {
    expect(
      await storage.verifyUserV2('pg-test-admin', 'pg-test-password')
    ).toBe(true);
    await storage.setGlobalValue('integration', 'saved');
    await initPostgresDatabase();
    expect(await storage.verifyUserV2('reader', 'reader-password')).toBe(true);
    expect(await storage.verifyUserV2('reader', 'wrong-password')).toBe(false);
    expect(await storage.getGlobalValue('integration')).toBe('saved');
  });

  test('round-trips playback progress, flags and millisecond timestamps as numbers', async () => {
    await storage.setPlayRecord('reader', 'source+1', record);
    expect(await storage.getPlayRecord('reader', 'source+1')).toMatchObject(
      record
    );
    await storage.setPlayRecord('reader', 'source+1', {
      ...record,
      play_time: 240,
    });
    const records = await storage.getAllPlayRecords('reader');
    expect(records['source+1'].play_time).toBe(240);
    expect(records['source+1'].save_time).toBe(record.save_time);
  });

  test('round-trips favorites and search history', async () => {
    const favorite = { ...record, origin: 'vod' as const, is_completed: true };
    await storage.setFavorite('reader', 'source+1', favorite);
    expect(await storage.getFavorite('reader', 'source+1')).toMatchObject({
      title: record.title,
      save_time: record.save_time,
      is_completed: true,
    });
    await storage.addSearchHistory('reader', '测试');
    await storage.addSearchHistory('reader', '测试');
    expect(await storage.getSearchHistory('reader')).toEqual(['测试']);
    await storage.deleteFavorite('reader', 'source+1');
    expect(await storage.getFavorite('reader', 'source+1')).toBeNull();
  });

  test('supports JSON tag operators and converts only SQL placeholders', async () => {
    expect(await storage.getUsersByTag('vip')).toEqual(['reader']);
    const result = await adapter
      .prepare(
        "SELECT ?::text AS value, '?'::text AS literal, $$?$$::text AS body /* ? */ -- ?\n"
      )
      .bind('a?b')
      .first();
    expect(result).toEqual({ value: 'a?b', literal: '?', body: '?' });
    expect(
      await adapter
        .prepare('SELECT COUNT(*) AS count FROM users')
        .first('count')
    ).toBe(2);
    expect(
      await adapter.prepare('SELECT 9007199254740993::bigint AS id').first('id')
    ).toBe('9007199254740993');
  });

  test('commits batches and rolls back every statement when a write fails', async () => {
    const insert = (key: string) =>
      adapter
        .prepare(
          'INSERT INTO global_config (key, value, updated_at) VALUES (?, ?, ?)'
        )
        .bind(key, 'value', Date.now());
    await adapter.batch([insert('batch-one'), insert('batch-two')]);
    expect(await storage.getGlobalValue('batch-two')).toBe('value');
    await expect(
      adapter.batch([insert('rolled-back'), insert('batch-one')])
    ).rejects.toThrow();
    expect(await storage.getGlobalValue('rolled-back')).toBeNull();
    expect(await storage.getGlobalValue('batch-one')).toBe('value');
  });

  test('propagates query failures instead of returning empty successful results', async () => {
    await expect(
      adapter.prepare('SELECT * FROM missing_table').first()
    ).rejects.toThrow();
    await expect(
      adapter.prepare('SELECT * FROM missing_table').all()
    ).rejects.toThrow();
    await expect(
      adapter.prepare('INSERT INTO missing_table VALUES (1)').run()
    ).rejects.toThrow();
    expect(await adapter.prepare('SELECT 1 WHERE FALSE').first()).toBeNull();
    expect(getPostgresPool()).toBe(getPostgresPool());
  });

  test('stores and browses catalog resources using the PostgreSQL adapter', async () => {
    const catalog = new CatalogStore(adapter);
    const source = {
      key: 'test',
      name: '测试源',
      api: 'https://source.invalid/api',
    };
    const other = { ...source, key: 'other' };
    const raw = {
      vod_id: '1',
      vod_name: '三体 第一季',
      vod_year: '2023',
      type_id: '2',
      type_name: '国产剧',
      vod_area: '中国大陆',
      vod_play_from: 'hls',
      vod_play_url: '第1集$https://video.invalid/1.m3u8',
      vod_time: '2026-11-01 10:00:00',
    };
    const item = normalizeCmsItem({ ...raw, vod_douban_id: 34900321 }, source)!;
    const fallback = normalizeCmsItem(
      { ...raw, vod_name: '三体 第1季', type_name: '热播' },
      other
    )!;
    await catalog.put(item, Date.now(), false);
    await catalog.put(fallback, Date.now(), false);
    expect((await catalog.search([source], { query: '三体' }))[0].title).toBe(
      '三体 第一季'
    );
    const wall = await catalog.browse([source, other], {
      query: '三体 第一季',
    });
    expect(wall.total).toBe(1);
    expect(wall.results[0].resource_count).toBe(2);
    expect(
      await catalog.search([source, other], { workId: fallback.workId })
    ).toHaveLength(2);
  });

  test('global format filtering includes alternate M3U8 lines and keeps PostgreSQL pagination accurate', async () => {
    const catalog = new CatalogStore(adapter);
    const source = {
      key: 'format-policy',
      name: '格式筛选',
      api: 'https://format.test/cms',
    };
    for (const [id, urls, names] of [
      ['file', '文件$https://video.test/a.mp4', 'file'],
      [
        'mixed',
        '文件$https://video.test/a.mp4$$$第四集$https://video.test/a.M3U8?sign=keep',
        'file$$$hls',
      ],
      ['hls', '正片$https://video.test/b.m3u8', 'hls'],
    ])
      await catalog.put(
        normalizeCmsItem(
          {
            vod_id: id,
            vod_name: `格式-${id}`,
            vod_year: '2026',
            type_name: '电影',
            vod_play_from: names,
            vod_play_url: urls,
          },
          source
        )!,
        Date.now(),
        false
      );
    const first = await catalog.browse([source], { m3u8Only: true, limit: 1 });
    expect(first.total).toBe(2);
    expect(first.pageCount).toBe(2);
    expect(
      (await catalog.browse([source], { m3u8Only: true, limit: 1, page: 2 }))
        .results
    ).toHaveLength(1);
    expect(await catalog.detail(source, 'file', { m3u8Only: true })).toBeNull();
    expect(
      (await catalog.detail(source, 'mixed', { m3u8Only: true }))?.episodes
    ).toEqual(['https://video.test/a.M3U8?sign=keep']);
    expect((await catalog.browse([source])).total).toBe(3);
  });
});
