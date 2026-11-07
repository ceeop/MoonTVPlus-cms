/* eslint-disable @typescript-eslint/no-var-requires */

import { createHash, randomUUID } from 'crypto';

import type { ApiSite } from '@/lib/config';
import type { D1PreparedStatement, DatabaseAdapter } from '@/lib/d1-adapter';
import { filterM3u8SourceResult } from '@/lib/m3u8-source-filter';
import type { SearchResult } from '@/lib/types';

import {
  type CatalogCategoryConfig,
  activeCatalogBindings,
  activeCatalogCategories,
  catalogCategoryIds,
  categoryCollectionPolicy,
} from './category-config';
import {
  CatalogCard,
  CatalogItem,
  CatalogKind,
  catalogRetentionCutoff,
  normalizeTitle,
  sourceRevision,
  SyncState,
  titleTerms,
} from './model';
import {
  catalogPosterId,
  downloadCatalogPoster,
  POSTER_PREFIX,
} from './posters';

type Row = Record<string, string | number>;
export interface CatalogQuery {
  m3u8Only?: boolean;
  query?: string;
  kind?: string;
  year?: string;
  area?: string;
  workId?: string;
  typeId?: string;
  page?: number;
  limit?: number;
  order?: string;
  excludeRestricted?: boolean;
  kinds?: CatalogKind[];
  categoryId?: string;
  categoryConfig?: CatalogCategoryConfig;
  defaultSourceKey?: string;
  cleanupEnabled?: boolean;
  retentionMonths?: number;
}

export interface CatalogCleanup {
  lastRun: number;
  resources: number;
  works: number;
  posters: number;
}

export interface CatalogNavigationCategory {
  id: string;
  name: string;
  parentId: string;
  kind: string;
}

const schema = [
  `CREATE TABLE IF NOT EXISTS catalog_works (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, normalized_title TEXT NOT NULL,
    kind TEXT NOT NULL, year TEXT NOT NULL, area TEXT NOT NULL, poster TEXT NOT NULL,
    description TEXT NOT NULL, updated_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS catalog_resources (
    source_key TEXT NOT NULL, remote_id TEXT NOT NULL, work_id TEXT NOT NULL,
    source_revision TEXT NOT NULL, restricted INTEGER NOT NULL, type_name TEXT NOT NULL,
    type_id TEXT NOT NULL, payload TEXT NOT NULL, source_updated_at BIGINT NOT NULL,
    indexed_at BIGINT NOT NULL, PRIMARY KEY (source_key, remote_id))`,
  `CREATE TABLE IF NOT EXISTS catalog_sync (
    source_key TEXT PRIMARY KEY, state TEXT NOT NULL, lease_token TEXT NOT NULL,
    lease_until BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS catalog_terms (
    term TEXT NOT NULL, work_id TEXT NOT NULL, PRIMARY KEY (term, work_id))`,
  `CREATE TABLE IF NOT EXISTS catalog_posters (
    id TEXT PRIMARY KEY, content_type TEXT NOT NULL, data TEXT NOT NULL, updated_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS catalog_resource_posters (
    source_key TEXT NOT NULL, remote_id TEXT NOT NULL, poster_id TEXT NOT NULL,
    retry_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (source_key, remote_id))`,
  `CREATE TABLE IF NOT EXISTS catalog_maintenance (
    id TEXT PRIMARY KEY, last_run BIGINT NOT NULL, next_run BIGINT NOT NULL,
    lease_token TEXT NOT NULL, lease_until BIGINT NOT NULL, summary TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS catalog_category_scopes (id TEXT PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS catalog_category_defs (
    scope_key TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT NOT NULL, kind TEXT NOT NULL,
    PRIMARY KEY(scope_key, id))`,
  `CREATE TABLE IF NOT EXISTS catalog_category_members (
    scope_key TEXT NOT NULL, category_id TEXT NOT NULL, member_id TEXT NOT NULL,
    PRIMARY KEY(scope_key, category_id, member_id))`,
  `CREATE TABLE IF NOT EXISTS catalog_category_bindings (
    scope_key TEXT NOT NULL, source_key TEXT NOT NULL, type_id TEXT NOT NULL, category_id TEXT NOT NULL,
    PRIMARY KEY (scope_key, source_key, type_id))`,
  'CREATE INDEX IF NOT EXISTS catalog_resources_work ON catalog_resources(work_id, source_key)',
  'CREATE INDEX IF NOT EXISTS catalog_resources_source ON catalog_resources(source_revision, source_updated_at)',
  'CREATE INDEX IF NOT EXISTS catalog_resources_browse ON catalog_resources(source_revision, source_key, type_id, restricted, indexed_at, work_id, source_updated_at, remote_id)',
  'CREATE INDEX IF NOT EXISTS catalog_works_filters ON catalog_works(kind, year, updated_at)',
  'CREATE INDEX IF NOT EXISTS catalog_resources_age ON catalog_resources(indexed_at)',
  'CREATE INDEX IF NOT EXISTS catalog_poster_refs ON catalog_resource_posters(poster_id)',
  'CREATE INDEX IF NOT EXISTS catalog_category_scope ON catalog_category_bindings(scope_key, category_id)',
];

export class CatalogStore {
  private ready?: Promise<void>;
  private posterDownloads = new Map<string, Promise<string | null>>();
  private categoryScopes = new Map<string, Promise<void>>();
  constructor(private adapter: DatabaseAdapter) {}

  async init(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        for (const sql of schema) await this.run(sql);
      })().catch((error) => {
        this.ready = undefined;
        throw error;
      });
    }
    await this.ready;
  }

  private statement(
    sql: string,
    values: Array<string | number> = []
  ): D1PreparedStatement {
    return this.adapter.prepare(sql).bind(...values);
  }

  private async run(
    sql: string,
    values: Array<string | number> = []
  ): Promise<number> {
    const result = await this.statement(sql, values).run();
    if (!result.success) throw new Error(result.error || '片库写入失败');
    return Number(result.meta?.changes || 0);
  }

  async rows(sql: string, values: Array<string | number> = []): Promise<Row[]> {
    const result = await this.statement(sql, values).all<Row>();
    if (!result.success) throw new Error(result.error || '片库查询失败');
    return result.results || [];
  }

  async put(
    item: CatalogItem,
    now = Date.now(),
    downloadPoster = true
  ): Promise<SearchResult> {
    await this.init();
    const r = { ...item.result };
    const origin = r.poster;
    const posterId = catalogPosterId(origin);
    if (posterId && downloadPoster) await this.cachePoster(origin, now);
    r.poster = posterId ? POSTER_PREFIX + posterId : '';
    // Write the resource before its work/terms so concurrent orphan cleanup cannot remove an in-flight work.
    await this.run(
      `INSERT INTO catalog_resources
      (source_key, remote_id, work_id, source_revision, restricted, type_name, type_id, payload, source_updated_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_key, remote_id) DO UPDATE SET
      work_id=excluded.work_id, type_id=excluded.type_id, payload=excluded.payload,
      source_revision=excluded.source_revision, restricted=excluded.restricted, type_name=excluded.type_name,
      source_updated_at=excluded.source_updated_at, indexed_at=excluded.indexed_at`,
      [
        r.source,
        r.id,
        item.workId,
        item.revision,
        item.restricted ? 1 : 0,
        r.type_name || '',
        item.typeId,
        JSON.stringify({
          ...r,
          catalog_play_lines: item.playLines,
          catalog_poster_origin: origin,
        }),
        item.updatedAt || now,
        now,
      ]
    );
    if (posterId) {
      await this.run(
        `INSERT INTO catalog_resource_posters (source_key, remote_id, poster_id) VALUES (?, ?, ?)
        ON CONFLICT(source_key, remote_id) DO UPDATE SET poster_id=excluded.poster_id, retry_at=0`,
        [r.source, r.id, posterId]
      );
    } else {
      await this.run(
        'DELETE FROM catalog_resource_posters WHERE source_key=? AND remote_id=?',
        [r.source, r.id]
      );
    }
    await this.run(
      `INSERT INTO catalog_works
      (id, title, normalized_title, kind, year, area, poster, description, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
      poster = CASE WHEN excluded.poster <> '' THEN excluded.poster ELSE catalog_works.poster END,
      description = CASE WHEN excluded.description <> '' THEN excluded.description ELSE catalog_works.description END,
      updated_at = CASE WHEN excluded.updated_at > catalog_works.updated_at THEN excluded.updated_at ELSE catalog_works.updated_at END`,
      [
        item.workId,
        item.title,
        item.normalizedTitle,
        item.kind,
        item.year,
        item.area,
        r.poster,
        r.desc || '',
        item.updatedAt || now,
      ]
    );
    const terms = titleTerms(item.title);
    for (let offset = 0; offset < terms.length; offset += 30) {
      const chunk = terms.slice(offset, offset + 30);
      await this.run(
        `INSERT INTO catalog_terms (term, work_id) VALUES ${chunk
          .map(() => '(?, ?)')
          .join(',')}
        ON CONFLICT(term, work_id) DO NOTHING`,
        chunk.flatMap((term) => [term, item.workId])
      );
    }
    return r;
  }

  private async cachePoster(url: string, now: number): Promise<string | null> {
    const id = catalogPosterId(url);
    if (!id) return null;
    // Touch atomically so orphan cleanup cannot remove an existing poster before it is linked.
    const existing = await this.rows(
      'UPDATE catalog_posters SET updated_at=? WHERE id=? RETURNING id',
      [now, id]
    );
    if (existing.length) return id;
    const active = this.posterDownloads.get(id);
    if (active) return active;
    const pending = (async () => {
      try {
        const image = await downloadCatalogPoster(url);
        if (!image) return null;
        await this.run(
          `INSERT INTO catalog_posters (id, content_type, data, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
          [id, image.contentType, image.data, now]
        );
        return id;
      } catch {
        // A failed poster download must not stop collecting playable resources; backfill retries later.
        return null;
      } finally {
        this.posterDownloads.delete(id);
      }
    })();
    this.posterDownloads.set(id, pending);
    return pending;
  }

  async poster(id: string, sites: ApiSite[], options: CatalogQuery = {}) {
    if (!sites.length || !/^[a-f0-9]{64}$/.test(id)) return null;
    await this.init();
    const where = await this.where(sites, options);
    let rows = await this.rows(
      `SELECT p.content_type, p.data FROM catalog_posters p WHERE p.id=? AND EXISTS (
        SELECT 1 FROM catalog_resource_posters rp
        JOIN catalog_resources r ON r.source_key=rp.source_key AND r.remote_id=rp.remote_id
        JOIN catalog_works w ON w.id=r.work_id
        WHERE rp.poster_id=p.id AND ${where.sql})`,
      [id, ...where.values]
    );
    if (!rows.length) {
      // Only a poster already referenced by a permitted resource can trigger a download.
      const resources = await this.rows(
        `SELECT r.payload, r.work_id FROM catalog_resource_posters rp
        JOIN catalog_resources r ON r.source_key=rp.source_key AND r.remote_id=rp.remote_id
        JOIN catalog_works w ON w.id=r.work_id
        WHERE rp.poster_id=? AND ${where.sql} LIMIT 1`,
        [id, ...where.values]
      );
      if (!resources.length) return null;
      const fallbackWhere = await this.where(sites, {
        ...options,
        workId: String(resources[0].work_id),
      });
      const alternatives = await this.rows(
        `SELECT r.payload, rp.poster_id, p.content_type, p.data FROM catalog_resources r
        JOIN catalog_works w ON w.id=r.work_id
        JOIN catalog_resource_posters rp ON rp.source_key=r.source_key AND rp.remote_id=r.remote_id
        LEFT JOIN catalog_posters p ON p.id=rp.poster_id
        WHERE rp.poster_id<>? AND rp.poster_id<>'' AND ${fallbackWhere.sql}
        ORDER BY CASE WHEN p.id IS NULL THEN 1 ELSE 0 END, r.source_updated_at DESC LIMIT 3`,
        [id, ...fallbackWhere.values]
      );
      // Reuse an authorized, already-saved poster from the same work before trying a failing image host.
      if (alternatives[0]?.data) rows = [alternatives[0]];
      const payload = JSON.parse(String(resources[0].payload));
      const origin = payload.catalog_poster_origin;
      if (
        !rows.length &&
        catalogPosterId(origin) === id &&
        (await this.cachePoster(origin, Date.now()))
      ) {
        rows = await this.rows(
          'SELECT content_type, data FROM catalog_posters WHERE id=?',
          [id]
        );
      }
      const attempted = new Set([id]);
      for (const alternative of alternatives) {
        if (rows.length) break;
        if (attempted.has(String(alternative.poster_id))) continue;
        attempted.add(String(alternative.poster_id));
        const alternateOrigin = JSON.parse(
          String(alternative.payload)
        ).catalog_poster_origin;
        if (catalogPosterId(alternateOrigin) !== alternative.poster_id)
          continue;
        const alternateId = await this.cachePoster(alternateOrigin, Date.now());
        if (alternateId)
          rows = await this.rows(
            'SELECT content_type, data FROM catalog_posters WHERE id=?',
            [alternateId]
          );
      }
    }
    return rows.length
      ? {
          contentType: String(rows[0].content_type),
          data: Buffer.from(String(rows[0].data), 'base64'),
        }
      : null;
  }

  // Gradually migrate existing remote posters and retry failed downloads, without extending resource retention.
  async backfillPosters(limit = 3, defaultSourceKey = ''): Promise<void> {
    await this.init();
    const rows = await this.rows(
      `SELECT r.source_key, r.remote_id, r.payload FROM (
      SELECT r.source_key, r.remote_id FROM catalog_resources r
      LEFT JOIN catalog_resource_posters rp ON rp.source_key=r.source_key AND rp.remote_id=r.remote_id
      LEFT JOIN catalog_posters p ON p.id=rp.poster_id
      WHERE p.id IS NULL AND COALESCE(rp.retry_at, 0)<=?
      ORDER BY CASE WHEN r.source_key=? THEN 0 ELSE 1 END,
        COALESCE(rp.retry_at, 0), r.indexed_at DESC LIMIT ?
      ) pending JOIN catalog_resources r
        ON r.source_key=pending.source_key AND r.remote_id=pending.remote_id`,
      [Date.now(), defaultSourceKey, limit]
    );
    await Promise.all(
      rows.map(async (row) => {
        const payload = JSON.parse(String(row.payload));
        const origin = payload.catalog_poster_origin || payload.poster;
        const id = await this.cachePoster(origin, Date.now());
        if (!id) {
          await this.run(
            `INSERT INTO catalog_resource_posters (source_key, remote_id, poster_id, retry_at) VALUES (?, ?, '', ?)
          ON CONFLICT(source_key, remote_id) DO UPDATE SET retry_at=excluded.retry_at
          WHERE catalog_resource_posters.poster_id=?`,
            [
              String(row.source_key),
              String(row.remote_id),
              Date.now() + 6 * 3600000,
              catalogPosterId(origin) || '',
            ]
          );
          return;
        }
        // Compare the payload to avoid overwriting a concurrent detail/collector refresh.
        const changed = await this.run(
          'UPDATE catalog_resources SET payload=? WHERE source_key=? AND remote_id=? AND payload=?',
          [
            JSON.stringify({
              ...payload,
              poster: POSTER_PREFIX + id,
              catalog_poster_origin: origin,
            }),
            String(row.source_key),
            String(row.remote_id),
            String(row.payload),
          ]
        );
        if (changed)
          await this.run(
            `INSERT INTO catalog_resource_posters (source_key, remote_id, poster_id) VALUES (?, ?, ?)
        ON CONFLICT(source_key, remote_id) DO UPDATE SET poster_id=excluded.poster_id, retry_at=0`,
            [String(row.source_key), String(row.remote_id), id]
          );
      })
    );
  }

  async cleanupStatus(): Promise<CatalogCleanup | null> {
    await this.init();
    const rows = await this.rows(
      "SELECT summary FROM catalog_maintenance WHERE id='retention' AND last_run>0"
    );
    return rows.length ? JSON.parse(String(rows[0].summary)) : null;
  }

  async acquireSettingsLock(token: string, now = Date.now()): Promise<boolean> {
    await this.init();
    const rows = await this.rows(
      `INSERT INTO catalog_maintenance (id, last_run, next_run, lease_token, lease_until, summary)
      VALUES ('settings', 0, 0, ?, ?, '{}') ON CONFLICT(id) DO UPDATE SET
      lease_token=excluded.lease_token, lease_until=excluded.lease_until
      WHERE catalog_maintenance.lease_until < ? RETURNING id`,
      [token, now + 90000, now]
    );
    return rows.length > 0;
  }

  async releaseSettingsLock(token: string): Promise<void> {
    await this.run(
      "UPDATE catalog_maintenance SET lease_until=0 WHERE id='settings' AND lease_token=?",
      [token]
    );
  }

  async cleanupExpired(
    now = Date.now(),
    force = false,
    retentionMonths = 6
  ): Promise<CatalogCleanup | null> {
    await this.init();
    const token = randomUUID();
    const lease = await this.rows(
      `INSERT INTO catalog_maintenance (id, last_run, next_run, lease_token, lease_until, summary)
      VALUES ('retention', 0, 0, ?, ?, '{}')
      ON CONFLICT(id) DO UPDATE SET lease_token=excluded.lease_token, lease_until=excluded.lease_until
      WHERE catalog_maintenance.lease_until < ? AND (catalog_maintenance.next_run <= ? OR ?=1)
      RETURNING id`,
      [token, now + 5 * 60000, now, now, force ? 1 : 0]
    );
    if (!lease.length) return null;
    try {
      const resources = await this.run(
        'DELETE FROM catalog_resources WHERE indexed_at < ?',
        [catalogRetentionCutoff(now, retentionMonths)]
      );
      const works = await this.run(
        'DELETE FROM catalog_works WHERE NOT EXISTS (SELECT 1 FROM catalog_resources r WHERE r.work_id=catalog_works.id)'
      );
      await this.run(
        'DELETE FROM catalog_terms WHERE NOT EXISTS (SELECT 1 FROM catalog_works w WHERE w.id=catalog_terms.work_id)'
      );
      await this.run(
        'DELETE FROM catalog_resource_posters WHERE NOT EXISTS (SELECT 1 FROM catalog_resources r WHERE r.source_key=catalog_resource_posters.source_key AND r.remote_id=catalog_resource_posters.remote_id)'
      );
      // A one-day grace period protects posters being linked by a concurrent writer.
      const posters = await this.run(
        'DELETE FROM catalog_posters WHERE updated_at < ? AND NOT EXISTS (SELECT 1 FROM catalog_resource_posters rp WHERE rp.poster_id=catalog_posters.id)',
        [now - 86400000]
      );
      const summary: CatalogCleanup = {
        lastRun: now,
        resources,
        works,
        posters,
      };
      await this.run(
        "UPDATE catalog_maintenance SET last_run=?, next_run=?, summary=?, lease_until=0 WHERE id='retention' AND lease_token=?",
        [now, now + 86400000, JSON.stringify(summary), token]
      );
      return summary;
    } catch (error) {
      await this.run(
        "UPDATE catalog_maintenance SET next_run=?, lease_until=0 WHERE id='retention' AND lease_token=?",
        [now + 60000, token]
      );
      throw error;
    }
  }

  private async categoryScope(config: CatalogCategoryConfig): Promise<string> {
    const key = createHash('sha256')
      .update(categoryCollectionPolicy(config))
      .digest('hex');
    if (!this.categoryScopes.has(key)) {
      const pending = (async () => {
        if (
          (
            await this.rows(
              'SELECT id FROM catalog_category_scopes WHERE id=?',
              [key]
            )
          ).length
        )
          return;
        const categories = activeCatalogCategories(config);
        for (let offset = 0; offset < categories.length; offset += 20) {
          const batch = categories.slice(offset, offset + 20);
          await this.run(
            `INSERT INTO catalog_category_defs (scope_key, id, parent_id, kind)
            VALUES ${batch
              .map(() => '(?, ?, ?, ?)')
              .join(',')} ON CONFLICT(scope_key, id) DO NOTHING`,
            batch.flatMap((category) => [
              key,
              category.id,
              category.parentId,
              category.kind,
            ])
          );
        }
        const members = categories.flatMap((category) =>
          catalogCategoryIds(config, category.id).map((member) => [
            key,
            category.id,
            member,
          ])
        );
        for (let offset = 0; offset < members.length; offset += 20) {
          const batch = members.slice(offset, offset + 20);
          await this.run(
            `INSERT INTO catalog_category_members (scope_key, category_id, member_id)
            VALUES ${batch
              .map(() => '(?, ?, ?)')
              .join(
                ','
              )} ON CONFLICT(scope_key, category_id, member_id) DO NOTHING`,
            batch.flat()
          );
        }
        const bindings = activeCatalogBindings(config);
        for (let offset = 0; offset < bindings.length; offset += 20) {
          const batch = bindings.slice(offset, offset + 20);
          await this.run(
            `INSERT INTO catalog_category_bindings (scope_key, source_key, type_id, category_id)
            VALUES ${batch.map(() => '(?, ?, ?, ?)').join(',')}
            ON CONFLICT(scope_key, source_key, type_id) DO NOTHING`,
            batch.flatMap((binding) => [
              key,
              binding.sourceKey,
              binding.typeId,
              binding.categoryId,
            ])
          );
        }
        // Publish the marker last so another process cannot observe a partially built mapping.
        await this.run(
          'INSERT INTO catalog_category_scopes (id) VALUES (?) ON CONFLICT(id) DO NOTHING',
          [key]
        );
      })().catch((error) => {
        this.categoryScopes.delete(key);
        throw error;
      });
      this.categoryScopes.set(key, pending);
    }
    await this.categoryScopes.get(key);
    return key;
  }

  private async where(sites: ApiSite[], options: CatalogQuery) {
    const values: Array<string | number> = sites.map(sourceRevision);
    const clauses = [
      `r.source_revision IN (${sites.map(() => '?').join(',')})`,
    ];
    if (options.cleanupEnabled !== false) {
      clauses.push('r.indexed_at >= ?');
      values.push(catalogRetentionCutoff(Date.now(), options.retentionMonths));
    }
    if (options.categoryConfig?.Categories !== undefined) {
      const scope = await this.categoryScope(options.categoryConfig);
      clauses.push(`(r.source_key, r.type_id) IN (SELECT m.source_key, m.type_id FROM catalog_category_bindings m
        JOIN catalog_category_defs d ON d.scope_key=m.scope_key AND d.id=m.category_id
        WHERE m.scope_key=?${
          options.categoryId
            ? ' AND EXISTS (SELECT 1 FROM catalog_category_members cm WHERE cm.scope_key=m.scope_key AND cm.category_id=? AND cm.member_id=m.category_id)'
            : ''
        }${options.kind ? ' AND d.kind=?' : ''})`);
      values.push(scope);
      if (options.categoryId) values.push(options.categoryId);
      if (options.kind) values.push(options.kind);
    } else if (options.categoryId) clauses.push('1=0');
    if (options.kinds) {
      clauses.push(
        options.kinds.length
          ? `w.kind IN (${options.kinds.map(() => '?').join(',')})`
          : '1=0'
      );
      values.push(...options.kinds);
    }
    if (options.excludeRestricted) clauses.push('r.restricted=0');
    if (options.m3u8Only) {
      if (this.adapter.dialect === 'postgres') {
        clauses.push(`EXISTS (SELECT 1 FROM (
          SELECT jsonb_array_elements_text(COALESCE(r.payload::jsonb->'episodes', '[]'::jsonb)) AS url
          UNION ALL SELECT jsonb_array_elements_text(line->'urls') FROM jsonb_array_elements(COALESCE(r.payload::jsonb->'catalog_play_lines', '[]'::jsonb)) AS line
        ) media WHERE lower(split_part(split_part(media.url, '?', 1), '#', 1)) LIKE '%.m3u8')`);
      } else {
        const matches =
          "lower(substr(media.value, 1, instr(replace(media.value, '#', '?') || '?', '?') - 1)) LIKE '%.m3u8'";
        clauses.push(`(EXISTS (SELECT 1 FROM json_each(r.payload, '$.episodes') media WHERE ${matches}) OR
          EXISTS (SELECT 1 FROM json_each(r.payload, '$.catalog_play_lines') line JOIN json_each(line.value, '$.urls') media WHERE ${matches}))`);
      }
    }
    const query = normalizeTitle(options.query || '').slice(0, 40);
    if (query) {
      const terms = titleTerms(query, true);
      clauses.push(`w.id IN (SELECT work_id FROM catalog_terms WHERE term IN (${terms
        .map(() => '?')
        .join(',')})
        GROUP BY work_id HAVING COUNT(DISTINCT term) = ?)`);
      values.push(...terms, terms.length);
      clauses.push('w.normalized_title LIKE ?');
      values.push(`%${query}%`);
    }
    for (const [key, column] of [
      ['kind', 'w.kind'],
      ['year', 'w.year'],
      ['area', 'w.area'],
      ['workId', 'w.id'],
      ['typeId', 'r.type_id'],
    ] as const) {
      if (key === 'kind' && options.categoryConfig?.Categories !== undefined)
        continue;
      if (options[key]) {
        clauses.push(`${column} = ?`);
        values.push(options[key] as string);
      }
    }
    return { sql: clauses.join(' AND '), values };
  }

  private hydrate(
    row: Row,
    sites: ApiSite[],
    m3u8Only = false
  ): SearchResult | null {
    const payload = JSON.parse(String(row.payload));
    delete payload.catalog_poster_origin;
    const result = payload as SearchResult;
    const site = sites.find((site) => site.key === result.source);
    return filterM3u8SourceResult(
      {
        ...result,
        poster: result.poster.startsWith(POSTER_PREFIX) ? result.poster : '',
        source_name: site?.name || result.source_name,
        proxyMode: site?.proxyMode || false,
      },
      m3u8Only
    );
  }

  async categories(site: ApiSite, options: CatalogQuery = {}) {
    await this.init();
    const where = await this.where([site], options);
    return this.rows(
      `SELECT DISTINCT r.type_id, r.type_name FROM catalog_resources r
      JOIN catalog_works w ON w.id=r.work_id WHERE ${where.sql}`,
      where.values
    );
  }

  async search(
    sites: ApiSite[],
    options: CatalogQuery = {}
  ): Promise<SearchResult[]> {
    if (!sites.length) return [];
    await this.init();
    const where = await this.where(sites, options);
    const limit = Math.max(1, Math.min(500, options.limit || 300));
    const rows = await this.rows(
      `SELECT r.payload FROM catalog_resources r JOIN catalog_works w ON w.id=r.work_id
      WHERE ${where.sql} ORDER BY CASE WHEN r.source_key=? THEN 0 ELSE 1 END,
        r.source_updated_at DESC, r.source_key, r.remote_id LIMIT ?`,
      [...where.values, options.defaultSourceKey || '', limit]
    );
    return rows.flatMap((row) => {
      const result = this.hydrate(row, sites, options.m3u8Only);
      return result ? [result] : [];
    });
  }

  async detail(
    site: ApiSite,
    id: string,
    options: CatalogQuery = {}
  ): Promise<SearchResult | null> {
    await this.init();
    const where = await this.where([site], options);
    const rows = await this.rows(
      `SELECT r.payload FROM catalog_resources r JOIN catalog_works w ON w.id=r.work_id
      WHERE r.source_key=? AND r.remote_id=? AND ${where.sql}`,
      [site.key, id, ...where.values]
    );
    return rows.length ? this.hydrate(rows[0], [site], options.m3u8Only) : null;
  }

  private navigationCategories(
    facets: Row[],
    options: CatalogQuery
  ): CatalogNavigationCategory[] {
    if (options.categoryConfig?.Categories !== undefined) {
      const availableTypes = new Set(
        facets.map((row) => JSON.stringify([row.source_key, row.type_id]))
      );
      const bindings = activeCatalogBindings(options.categoryConfig);
      return activeCatalogCategories(options.categoryConfig)
        .filter((category) => {
          const ids = new Set(
            catalogCategoryIds(options.categoryConfig || {}, category.id)
          );
          return bindings.some(
            (binding) =>
              ids.has(binding.categoryId) &&
              availableTypes.has(
                JSON.stringify([binding.sourceKey, binding.typeId])
              )
          );
        })
        .map(({ id, name, kind, parentId }) => ({ id, name, kind, parentId }));
    }
    return (['movie', 'tv', 'anime', 'variety', 'other'] as const)
      .filter((kind) => facets.some((row) => row.kind === kind))
      .map((kind) => ({
        id: kind,
        name: {
          movie: '电影',
          tv: '电视剧',
          anime: '动漫',
          variety: '综艺',
          other: '其他',
        }[kind],
        kind,
        parentId: '',
      }));
  }

  async navigation(sites: ApiSite[], options: CatalogQuery = {}) {
    if (!sites.length) return [];
    await this.init();
    const where = await this.where(sites, options);
    let facets: Row[];
    if (options.categoryConfig?.Categories !== undefined) {
      const scope = await this.categoryScope(options.categoryConfig);
      // Stop at the first permitted resource for each binding; navigation needs
      // neither a full count nor video payloads, sorting or year/area facets.
      facets = await this.rows(
        `SELECT m.source_key, m.type_id FROM catalog_category_bindings m
        WHERE m.scope_key=? AND EXISTS (
          SELECT 1 FROM catalog_resources r JOIN catalog_works w ON w.id=r.work_id
          WHERE r.source_key=m.source_key AND r.type_id=m.type_id AND ${where.sql})`,
        [scope, ...where.values]
      );
    } else {
      facets = await this.rows(
        `SELECT DISTINCT w.kind FROM catalog_resources r
        JOIN catalog_works w ON w.id=r.work_id WHERE ${where.sql}`,
        where.values
      );
    }
    return this.navigationCategories(facets, options);
  }

  async browse(sites: ApiSite[], options: CatalogQuery = {}) {
    if (!sites.length)
      return {
        results: [] as CatalogCard[],
        total: 0,
        page: 1,
        pageCount: 0,
        years: [] as string[],
        areas: [] as string[],
        categories: [] as Array<{
          id: string;
          name: string;
          parentId: string;
          kind: string;
        }>,
      };
    await this.init();
    const where = await this.where(sites, options);
    const page = Math.max(1, Math.floor(options.page || 1));
    const limit = Math.max(1, Math.min(60, options.limit || 30));
    const counts = await this.rows(
      `SELECT COUNT(DISTINCT w.id) AS total FROM catalog_works w
      JOIN catalog_resources r ON r.work_id=w.id WHERE ${where.sql}`,
      where.values
    );
    const total = Number(counts[0]?.total || 0);
    const order =
      options.order === 'updated'
        ? 'updated_at DESC, title'
        : 'year DESC, updated_at DESC';
    // Page the small work metadata first. Loading/ranking every resource payload
    // before LIMIT makes even a one-card request process the entire catalog.
    const works = await this.rows(
      `SELECT w.id AS work_id, w.kind, w.year, w.area, w.title,
        MAX(r.source_updated_at) AS updated_at, COUNT(*) AS resource_count
      FROM catalog_works w JOIN catalog_resources r ON r.work_id=w.id
      WHERE ${where.sql} GROUP BY w.id
      ORDER BY ${order}, work_id LIMIT ? OFFSET ?`,
      [...where.values, limit, (page - 1) * limit]
    );
    const resources = new Map<string, Row>();
    // Reserve parameters for source permissions and long search terms within D1's limit.
    const batchSize = Math.max(1, Math.min(30, 99 - where.values.length));
    for (let offset = 0; offset < works.length; offset += batchSize) {
      const chunk = works.slice(offset, offset + batchSize);
      const rows = await this.rows(
        `SELECT ranked.work_id, selected.payload FROM (
          SELECT r.work_id, r.source_key, r.remote_id,
            ROW_NUMBER() OVER (PARTITION BY r.work_id ORDER BY
              CASE WHEN r.source_key=? THEN 0 ELSE 1 END,
              CASE WHEN EXISTS (SELECT 1 FROM catalog_resource_posters rp JOIN catalog_posters p ON p.id=rp.poster_id
                WHERE rp.source_key=r.source_key AND rp.remote_id=r.remote_id) THEN 0 ELSE 1 END,
              r.source_updated_at DESC, r.source_key, r.remote_id) AS position
          FROM catalog_resources r JOIN catalog_works w ON w.id=r.work_id
          WHERE r.work_id IN (${chunk.map(() => '?').join(',')}) AND ${
          where.sql
        }
        ) ranked JOIN catalog_resources selected
          ON selected.source_key=ranked.source_key AND selected.remote_id=ranked.remote_id
        WHERE ranked.position=1`,
        [
          options.defaultSourceKey || '',
          ...chunk.map((work) => String(work.work_id)),
          ...where.values,
        ]
      );
      for (const row of rows) resources.set(String(row.work_id), row);
    }
    const facetWhere = await this.where(sites, {
      m3u8Only: options.m3u8Only,
      cleanupEnabled: options.cleanupEnabled,
      retentionMonths: options.retentionMonths,
      kinds: options.kinds,
      excludeRestricted: options.excludeRestricted,
      categoryConfig: options.categoryConfig,
    });
    const facets = await this.rows(
      `SELECT DISTINCT w.year, w.area, w.kind, r.source_key, r.type_id FROM catalog_works w JOIN catalog_resources r ON r.work_id=w.id
      WHERE ${facetWhere.sql}`,
      facetWhere.values
    );
    return {
      categories: this.navigationCategories(facets, options),
      results: works.flatMap((row) => {
        const resource = resources.get(String(row.work_id));
        const hydrated = resource
          ? this.hydrate(resource, sites, options.m3u8Only)
          : null;
        return hydrated
          ? [
              {
                ...hydrated,
                work_id: String(row.work_id),
                kind: String(row.kind),
                area: String(row.area),
                resource_count: Number(row.resource_count),
                updated_at: Number(row.updated_at),
              },
            ]
          : [];
      }) as CatalogCard[],
      total,
      page,
      pageCount: Math.ceil(total / limit),
      years: Array.from(
        new Set(facets.map((row) => String(row.year)).filter(Boolean))
      )
        .sort()
        .reverse(),
      areas: Array.from(
        new Set(facets.map((row) => String(row.area)).filter(Boolean))
      ).sort(),
    };
  }

  async states(): Promise<
    Array<{ source: string; state: SyncState; running: boolean; count: number }>
  > {
    await this.init();
    const rows = await this.rows(`SELECT s.source_key, s.state, s.lease_until,
      (SELECT COUNT(*) FROM catalog_resources r WHERE r.source_key=s.source_key) AS count FROM catalog_sync s`);
    return rows.map((row) => ({
      source: String(row.source_key),
      state: JSON.parse(String(row.state)),
      running: Number(row.lease_until) > Date.now(),
      count: Number(row.count),
    }));
  }

  async acquire(
    source: string,
    token: string,
    initial: SyncState,
    now: number
  ): Promise<SyncState | null> {
    await this.init();
    const rows = await this.rows(
      `INSERT INTO catalog_sync (source_key, state, lease_token, lease_until) VALUES (?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET lease_token=excluded.lease_token, lease_until=excluded.lease_until
      WHERE catalog_sync.lease_until < ? RETURNING state`,
      [source, JSON.stringify(initial), token, now + 90000, now]
    );
    return rows.length ? JSON.parse(String(rows[0].state)) : null;
  }

  async checkpoint(
    source: string,
    token: string,
    state: SyncState
  ): Promise<void> {
    const rows = await this.rows(
      `UPDATE catalog_sync SET state=?, lease_until=?
      WHERE source_key=? AND lease_token=? AND lease_until>=? RETURNING source_key`,
      [JSON.stringify(state), Date.now() + 90000, source, token, Date.now()]
    );
    if (!rows.length) throw new Error('采集任务锁已过期，请重试');
  }

  async release(source: string, token: string): Promise<void> {
    await this.run(
      'UPDATE catalog_sync SET lease_until=0 WHERE source_key=? AND lease_token=?',
      [source, token]
    );
  }
}

let singleton: CatalogStore | undefined;
export function getCatalogStore(): CatalogStore {
  if (!singleton) {
    // Reuse SQL backends; Redis deployments on a persistent Node server get a separate SQLite catalog.
    const {
      getD1Adapter,
      getPostgresAdapter,
      getTursoAdapter,
    } = require('@/lib/db');
    const storage = process.env.NEXT_PUBLIC_STORAGE_TYPE;
    let adapter: DatabaseAdapter;
    if (storage === 'postgres') adapter = getPostgresAdapter();
    else if (storage === 'turso') adapter = getTursoAdapter();
    else {
      const cloudflare =
        process.env.BUILD_TARGET === 'cloudflare' ||
        process.env.CF_PAGES === '1';
      if (!cloudflare) {
        if (
          process.env.VERCEL ||
          process.env.NETLIFY ||
          process.env.EDGEONE_PAGES ||
          process.env.BUILD_TARGET === 'edgeone'
        ) {
          throw new Error(
            '当前部署需要为片库配置 PostgreSQL、Turso 或 Cloudflare D1 持久数据库'
          );
        }
        const path = require('path');
        require('fs').mkdirSync(
          path.dirname(
            process.env.SQLITE_DB_PATH ||
              path.join(process.cwd(), '.data', 'moontv.db')
          ),
          { recursive: true }
        );
      }
      adapter = getD1Adapter();
    }
    singleton = new CatalogStore(adapter);
  }
  return singleton;
}
