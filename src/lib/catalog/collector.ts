import { createHash, randomUUID } from 'crypto';

import { getConfig } from '@/lib/config';
import { parseJsonLosslessIntegers } from '@/lib/json';

import {
  activeCatalogBindings,
  categoryCollectionPolicy,
} from './category-config';
import {
  catalogCollectionDay,
  catalogItemEnabled,
  catalogSettings,
  cmsUpdatedAt,
  cmsUrl,
  normalizeCmsItem,
  SyncState,
} from './model';
import { getCatalogStore } from './store';

export async function collectCatalog(
  options: {
    source?: string;
    force?: boolean;
    reset?: boolean;
    budgetMs?: number;
  } = {}
) {
  const config = await getConfig(true);
  const settings = catalogSettings(config);
  if (!settings.Enabled && !config.CatalogConfig)
    return { processed: 0, message: '本地片库未启用' };
  const store = getCatalogStore();
  const cleanup =
    settings.CleanupEnabled !== false
      ? await store.cleanupExpired(Date.now(), false, settings.RetentionMonths)
      : null;
  // Retention continues after collection is disabled.
  if (!settings.Enabled)
    return { processed: 0, message: '本地片库未启用', cleanup };
  if (
    settings.Categories !== undefined &&
    !activeCatalogBindings(settings).some((binding) =>
      settings.SourceKeys.includes(binding.sourceKey)
    )
  )
    return {
      processed: 0,
      message: '暂无可采集分类，请在采集设置中选择分类',
      cleanup,
    };
  const states = await store.states();
  const candidates = config.SourceConfig.filter(
    (site) =>
      !site.disabled &&
      settings.SourceKeys.includes(site.key) &&
      (!options.source || site.key === options.source)
  );
  // Start with the default source; rotate the remaining sources by their next scheduled run.
  candidates.sort((a, b) => {
    const primary = settings.DefaultSourceKey || settings.SourceKeys[0];
    const priority = Number(b.key === primary) - Number(a.key === primary);
    const order = (key: string) =>
      states.find((entry) => entry.source === key)?.state.retryAt || 0;
    return priority || order(a.key) - order(b.key);
  });
  const deadline = Date.now() + (options.budgetMs || 12000);
  let processed = 0;
  const completed = new Set<string>();
  const resetApplied = new Set<string>();
  for (const site of [...candidates, ...candidates, ...candidates]) {
    if (Date.now() >= deadline || processed >= 3) break;
    if (completed.has(site.key)) continue;
    const now = Date.now();
    const day = catalogCollectionDay(now);
    const fingerprint = createHash('sha256')
      .update(
        `daily-updates-v1\n${day.start}\n${site.api}\n${settings.Kinds.join(
          ','
        )}\n${categoryCollectionPolicy(settings, site.key)}`
      )
      .digest('hex');
    const initial: SyncState = {
      fingerprint,
      nextPage: 1,
      totalPages: 0,
      fullDone: false,
      lastSuccess: 0,
      startedAt: now,
      windowHours: Math.max(1, Math.ceil((now - day.start) / 3600000)),
      action: 'incremental',
      error: '',
      retryAt: 0,
    };
    const token = randomUUID();
    let state = await store.acquire(site.key, token, initial, now);
    if (!state) continue;
    try {
      if (
        state.fingerprint !== fingerprint ||
        (options.reset && !resetApplied.has(site.key))
      ) {
        state = { ...initial, lastSuccess: state.lastSuccess };
        resetApplied.add(site.key);
      }
      if (!options.force && state.retryAt > now) continue;
      if (state.fullDone && state.nextPage === 1) {
        if (
          !options.force &&
          now - state.lastSuccess < settings.IntervalMinutes * 60000
        )
          continue;
        state.action = 'incremental';
        state.startedAt = now;
        state.fullDone = false;
        state.totalPages = 0;
      }
      // Round up the API's hour window, then enforce the exact day on returned timestamps.
      state.windowHours = Math.max(
        1,
        Math.ceil((Date.now() - day.start) / 3600000)
      );
      state.error = '';
      await store.checkpoint(site.key, token, state);
      const url = cmsUrl(site.api, {
        ac: 'videolist',
        pg: state.nextPage,
        h: state.windowHours,
      });
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      });
      if (!response.ok) throw new Error(`源站返回 HTTP ${response.status}`);
      const data = parseJsonLosslessIntegers<{
        list?: Record<string, unknown>[];
        pagecount?: number;
        code?: number;
      }>(await response.text());
      if (
        !Array.isArray(data.list) ||
        (data.code !== undefined &&
          Number(data.code) !== 1 &&
          Number(data.code) !== 200)
      ) {
        throw new Error('源站未返回有效采集列表');
      }
      const pageCount = Number(data.pagecount ?? 1);
      if (!Number.isFinite(pageCount) || pageCount < 0 || pageCount > 1000000)
        throw new Error('源站分页信息无效');
      if (!data.list.length && state.nextPage > 1 && state.nextPage < pageCount)
        throw new Error('源站中间页为空，保留进度等待重试');
      const updateTimes = data.list.map((raw) => cmsUpdatedAt(raw.vod_time));
      if (data.list.length && !updateTimes.some((time) => time > 0))
        throw new Error('源站未提供有效更新时间，无法识别当天更新');
      // CMS update feeds are newest first. Stop at an older page even if a source ignores h.
      const reachedOlderPage =
        data.list.length > 0 &&
        updateTimes.every((time) => !time || time < day.start);
      for (let index = 0; index < data.list.length; index++) {
        if (index % 8 === 0) await store.checkpoint(site.key, token, state);
        const raw = data.list[index];
        const item = normalizeCmsItem(raw, site);
        if (
          item &&
          item.updatedAt >= day.start &&
          item.updatedAt < day.end &&
          catalogItemEnabled(config, item)
        )
          await store.put(item, Date.now(), false);
      }
      state.totalPages = pageCount;
      if (
        !data.list.length ||
        state.nextPage >= pageCount ||
        reachedOlderPage
      ) {
        completed.add(site.key);
        state.fullDone = true;
        state.nextPage = 1;
        // Keep the completed round's starting time for status and scheduling.
        state.lastSuccess = state.startedAt;
        state.retryAt = Date.now() + settings.IntervalMinutes * 60000;
      } else {
        state.nextPage += 1;
        state.retryAt = Date.now();
      }
      await store.checkpoint(site.key, token, state);
      processed++;
    } catch (error) {
      completed.add(site.key);
      state.error = (error as Error).message;
      state.retryAt = Date.now() + 5 * 60000;
      await store.checkpoint(site.key, token, state);
    } finally {
      await store.release(site.key, token);
    }
  }
  await store.backfillPosters(
    3,
    settings.DefaultSourceKey || settings.SourceKeys[0]
  );
  return {
    processed,
    message: processed ? '本批采集完成' : '暂无到期任务',
    states: await store.states(),
    cleanup,
  };
}
