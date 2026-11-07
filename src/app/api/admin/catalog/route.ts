import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  fetchCmsCategories,
  mergeCatalogCategories,
} from '@/lib/catalog/cms-categories';
import { collectCatalog } from '@/lib/catalog/collector';
import { type CatalogSettings, catalogSettings } from '@/lib/catalog/model';
import {
  catalogTaxonomyRevision,
  mergeCollectionSettings,
  mergeTaxonomySettings,
  parseCatalogSettings,
} from '@/lib/catalog/settings';
import { getCatalogStore } from '@/lib/catalog/store';
import { type ApiSite, getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function isAdmin(request: NextRequest) {
  const auth = getAuthInfoFromCookie(request);
  if (!auth?.username) return false;
  if (auth.username === process.env.USERNAME) return true;
  const user = await db.getUserInfoV2(auth.username);
  return (
    user && !user.banned && (user.role === 'admin' || user.role === 'owner')
  );
}

async function readSourceCategories(sites: ApiSite[]) {
  const catalogs = [];
  for (let offset = 0; offset < sites.length; offset += 6) {
    catalogs.push(
      ...(await Promise.all(
        sites.slice(offset, offset + 6).map(async (site) => {
          try {
            return await fetchCmsCategories(site);
          } catch (error) {
            return {
              sourceKey: site.key,
              categories: [],
              error: (error as Error).message,
            };
          }
        })
      ))
    );
  }
  return catalogs;
}

export async function GET(request: NextRequest) {
  if (!(await isAdmin(request)))
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  try {
    const config = await getConfig(true);
    return NextResponse.json(
      {
        settings: catalogSettings(config),
        taxonomyRevision: catalogTaxonomyRevision(catalogSettings(config)),
        sources: config.SourceConfig,
        states: await getCatalogStore().states(),
        cleanup: await getCatalogStore().cleanupStatus(),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 503 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin(request)))
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action === 'categories') {
      const config = await getConfig(true);
      let settings: CatalogSettings;
      try {
        settings = parseCatalogSettings({ ...body.settings, Enabled: false });
      } catch (error) {
        return NextResponse.json(
          { error: (error as Error).message },
          { status: 400 }
        );
      }
      settings.Enabled = body.settings?.Enabled === true;
      if (!settings.SourceKeys.length)
        return NextResponse.json({ error: '请先选择采集源' }, { status: 400 });
      const sites = settings.SourceKeys.map((key) =>
        config.SourceConfig.find((site) => site.key === key && !site.disabled)
      );
      if (sites.some((site) => !site))
        return NextResponse.json(
          { error: '所选源不存在或已停用' },
          { status: 400 }
        );
      const selectedSites = sites.filter(
        (site): site is NonNullable<typeof site> => !!site
      );
      const catalogs = await readSourceCategories(selectedSites);
      try {
        return NextResponse.json({
          settings: mergeCatalogCategories(settings, catalogs),
          errors: catalogs.filter((catalog) => catalog.error),
        });
      } catch (error) {
        return NextResponse.json(
          { error: (error as Error).message },
          { status: 400 }
        );
      }
    }
    if (body.action === 'save' || body.action === 'save-taxonomy') {
      const store = getCatalogStore();
      const token = randomUUID();
      if (!(await store.acquireSettingsLock(token)))
        return NextResponse.json(
          { error: '其他片库设置正在保存，请稍后重试' },
          { status: 409 }
        );
      try {
        const config = await getConfig(true);
        const current = catalogSettings(config);
        if (
          body.action === 'save-taxonomy' &&
          body.expectedRevision !== catalogTaxonomyRevision(current)
        )
          return NextResponse.json(
            { error: '分类设置已在其他页面更新，请重新加载后重试' },
            { status: 409 }
          );
        let settings: CatalogSettings;
        try {
          if (
            body.scope === 'collection' &&
            typeof body.settings?.Enabled !== 'boolean'
          )
            throw new Error('片库启用状态无效');
          settings =
            body.action === 'save-taxonomy'
              ? mergeTaxonomySettings(current, body.settings || {})
              : body.scope === 'collection'
              ? mergeCollectionSettings(current, {
                  ...body.settings,
                  Enabled: false,
                })
              : parseCatalogSettings(body.settings);
        } catch (error) {
          return NextResponse.json(
            { error: (error as Error).message },
            { status: 400 }
          );
        }
        await getCatalogStore().init();
        const valid = new Set(
          config.SourceConfig.filter((s) => !s.disabled).map((s) => s.key)
        );
        if (
          body.action !== 'save-taxonomy' &&
          settings.SourceKeys.some((key) => !valid.has(key))
        )
          return NextResponse.json(
            { error: '选择的源已停用或不支持采集，请刷新后重试' },
            { status: 400 }
          );
        if (body.action === 'save' && body.scope === 'collection') {
          settings.Enabled = body.settings?.Enabled === true;
          const primaryKey = settings.DefaultSourceKey;
          const syncPrimary =
            !!primaryKey &&
            (primaryKey !== current.DefaultSourceKey ||
              settings.Categories === undefined);
          const toRead = config.SourceConfig.filter(
            (site) =>
              settings.SourceKeys.includes(site.key) &&
              ((syncPrimary && site.key === primaryKey) ||
                !current.SourceKeys.includes(site.key))
          );
          if (toRead.length) {
            const catalogs = await readSourceCategories(toRead);
            const failed = catalogs.find((catalog) => catalog.error);
            if (failed)
              return NextResponse.json(
                {
                  error: `源分类同步失败（${
                    config.SourceConfig.find(
                      (site) => site.key === failed.sourceKey
                    )?.name || failed.sourceKey
                  }）：${failed.error}`,
                },
                { status: 400 }
              );
            try {
              settings = mergeCatalogCategories(
                settings,
                catalogs,
                syncPrimary
              );
            } catch (error) {
              return NextResponse.json(
                { error: (error as Error).message },
                { status: 400 }
              );
            }
          }
          try {
            const enabled = settings.Enabled;
            settings = parseCatalogSettings(
              syncPrimary ? { ...settings, Enabled: false } : settings
            );
            settings.Enabled = enabled;
          } catch (error) {
            return NextResponse.json(
              { error: (error as Error).message },
              { status: 400 }
            );
          }
        }
        const next = { ...config, CatalogConfig: settings };
        await db.saveAdminConfig(next);
        await setCachedConfig(next);
        return NextResponse.json({
          success: true,
          settings,
          taxonomyRevision: catalogTaxonomyRevision(settings),
        });
      } finally {
        await store.releaseSettingsLock(token);
      }
    }
    if (body.action === 'cleanup') {
      const settings = catalogSettings(await getConfig(true));
      const cleanup = await getCatalogStore().cleanupExpired(
        Date.now(),
        true,
        settings.RetentionMonths
      );
      return NextResponse.json({
        cleanup,
        message: cleanup
          ? `已清理 ${cleanup.resources} 条过期资源、${cleanup.works} 部作品和 ${cleanup.posters} 张海报`
          : '已有清理任务正在运行',
      });
    }
    if (body.action === 'collect' || body.action === 'rebuild') {
      if (typeof body.source !== 'string' || !body.source)
        return NextResponse.json({ error: '请选择一个源' }, { status: 400 });
      return NextResponse.json(
        await collectCatalog({
          source: body.source,
          force: true,
          reset: body.action === 'rebuild',
        })
      );
    }
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
