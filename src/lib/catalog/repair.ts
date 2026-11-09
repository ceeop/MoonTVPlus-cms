import type { DatabaseAdapter } from '@/lib/d1-adapter';
import type { SearchResult } from '@/lib/types';

import {
  CATALOG_KINDS,
  catalogDoubanPlaceholders,
  CatalogKind,
  catalogWorkId,
  normalizeTitle,
  titleTerms,
} from './model';

// Old work IDs were hashes of the supplied Douban ID and kind. Look those up
// directly, so a deployment does not have to scan or rewrite the whole catalog.
const legacyIds = catalogDoubanPlaceholders.flatMap((id) =>
  CATALOG_KINDS.map((kind) => catalogWorkId('', '', kind, id, '', ''))
);

interface LegacyResource {
  previous_id: string;
  source_key: string;
  remote_id: string;
  payload: string;
  kind: CatalogKind;
  title: string;
  year: string;
  area: string;
  source_updated_at: string | number;
}

const fields = {
  previous_id: 'text',
  work_id: 'text',
  source_key: 'text',
  remote_id: 'text',
  title: 'text',
  normalized_title: 'text',
  kind: 'text',
  year: 'text',
  area: 'text',
  poster: 'text',
  description: 'text',
  updated_at: 'bigint',
  original_title: 'integer',
  terms: 'jsonb',
};

// Reattach each resource by its own title. Leave source IDs, playback payloads,
// poster references and retention timestamps as they were.
export async function repairCatalogPlaceholders(adapter: DatabaseAdapter) {
  const postgres = adapter.dialect === 'postgres';
  const entries = Object.entries(fields);
  const changes = postgres
    ? `SELECT * FROM jsonb_to_recordset(?::jsonb) AS items(${entries
        .map(([name, type]) => `${name} ${type}`)
        .join(', ')})`
    : `SELECT ${entries
        .map(([name]) => `json_extract(value, '$.${name}') AS ${name}`)
        .join(', ')} FROM json_each(?)`;
  const terms = postgres
    ? 'CROSS JOIN LATERAL jsonb_array_elements_text(changes.terms) AS t(term)'
    : 'JOIN json_each(changes.terms) AS t ON 1=1';
  const batchSize = 200;
  let more = true;
  while (more) {
    const legacy = await adapter
      .prepare(
        `SELECT w.id AS previous_id, r.source_key, r.remote_id, r.payload,
        w.kind, w.title, w.year, w.area, r.source_updated_at
      FROM catalog_resources r JOIN catalog_works w ON w.id=r.work_id
      WHERE r.work_id IN (${legacyIds.map(() => '?').join(',')}) LIMIT ?`
      )
      .bind(...legacyIds, batchSize)
      .all<LegacyResource>();
    if (!legacy.success) throw new Error(legacy.error || '无法读取旧片库索引');
    if (!legacy.results?.length) return;

    const data = JSON.stringify(
      legacy.results.map((row) => {
        const result: SearchResult = JSON.parse(row.payload);
        const title = result.title || row.title;
        const normalized = normalizeTitle(title);
        const year = result.year || '';
        const originalTitle =
          normalized === normalizeTitle(row.title) && year === row.year;
        return {
          previous_id: row.previous_id,
          work_id: catalogWorkId(
            normalized,
            year,
            row.kind,
            0,
            row.source_key,
            row.remote_id
          ),
          source_key: row.source_key,
          remote_id: row.remote_id,
          title,
          normalized_title: normalized,
          kind: row.kind,
          year,
          area: originalTitle ? row.area : '',
          poster: result.poster || '',
          description: (result.desc || '').slice(0, 500),
          updated_at: row.source_updated_at,
          original_title: originalTitle ? 1 : 0,
          terms: titleTerms(title),
        };
      })
    );

    const statements = [
      `INSERT INTO catalog_works
        (id, title, normalized_title, kind, year, area, poster, description, updated_at)
        SELECT work_id, title, normalized_title, kind, year, area, poster, description, updated_at
        FROM changes WHERE 1=1 ON CONFLICT(id) DO NOTHING`,
      `INSERT INTO catalog_terms (term, work_id)
        SELECT t.${
          postgres ? 'term' : 'value'
        }, changes.work_id FROM changes ${terms}
        WHERE 1=1 ON CONFLICT(term, work_id) DO NOTHING`,
      `INSERT INTO catalog_work_redirects (id, work_id)
        SELECT previous_id, MIN(work_id) FROM changes WHERE original_title=1 GROUP BY previous_id
        ON CONFLICT(id) DO NOTHING`,
      `UPDATE catalog_resources AS r SET work_id=changes.work_id FROM changes
        WHERE r.source_key=changes.source_key AND r.remote_id=changes.remote_id AND r.work_id=changes.previous_id`,
    ].map((sql) =>
      adapter.prepare(`WITH changes AS (${changes}) ${sql}`).bind(data)
    );

    const written = adapter.batch
      ? await adapter.batch(statements)
      : await Promise.all(
          statements.slice(0, 3).map((statement) => statement.run())
        ).then(async (results) => {
          if (results.some((result) => !result.success)) return results;
          return [...results, await statements[3].run()];
        });
    const failed = written.find((result) => !result.success);
    if (failed) throw new Error(failed.error || '无法修复旧片库索引');
    more = legacy.results.length === batchSize;
  }
}
