import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { mirrorTVBoxAssets } from '@/lib/tvbox/assets';
import { cloudDriveReason } from '@/lib/tvbox/cloud-filter';
import {
  cmsImportKey,
  fetchTVBoxSubscription,
  httpSubscriptionUrl,
  isCMSImportable,
  tvboxSettings,
} from '@/lib/tvbox/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function editableSettings(config: AdminConfig) {
  const settings = tvboxSettings(config);
  return {
    ...settings,
    Subscriptions: settings.Subscriptions.map((entry) => ({ ...entry })),
  };
}

async function isAdmin(request: NextRequest) {
  const auth = getAuthInfoFromCookie(request);
  if (!auth?.username) return false;
  if (auth.username === process.env.USERNAME) return true;
  const user = await db.getUserInfoV2(auth.username);
  return (
    !!user && !user.banned && (user.role === 'admin' || user.role === 'owner')
  );
}

export async function GET(request: NextRequest) {
  if (!(await isAdmin(request)))
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  const config = await getConfig();
  return NextResponse.json(
    {
      settings: tvboxSettings(config),
      enabled: process.env.ENABLE_TVBOX_SUBSCRIBE === 'true',
      catalogEnabled: config.CatalogConfig?.Enabled === true,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin(request)))
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  try {
    const body = await request.json();
    let config = await getConfig();
    let settings = editableSettings(config);
    let message = '设置已保存';
    if (body.action === 'add' || body.action === 'refresh') {
      const existing = settings.Subscriptions.find(
        (entry) => entry.id === body.id
      );
      if (body.action === 'refresh' && !existing) throw new Error('订阅不存在');
      if (body.action === 'add' && settings.Subscriptions.length >= 20)
        throw new Error('最多添加 20 个订阅');
      const url = httpSubscriptionUrl(existing?.url || String(body.url || ''));
      const name =
        existing?.name ||
        String(body.name || '')
          .trim()
          .slice(0, 80);
      if (!name) throw new Error('请填写订阅名称');
      const document = await fetchTVBoxSubscription(url);
      const mirrored: Partial<Awaited<ReturnType<typeof mirrorTVBoxAssets>>> =
        settings.LocalAssetsEnabled !== false
          ? await mirrorTVBoxAssets(
              document,
              existing?.assets,
              url,
              body.action === 'refresh'
            )
          : {};
      // Reload after network I/O so another completed settings save is retained.
      config = await getConfig();
      settings = editableSettings(config);
      if (existing) {
        const current = settings.Subscriptions.find(
          (entry) => entry.id === existing.id
        );
        if (!current || current.url !== url)
          throw new Error('订阅已变更，请重新加载后重试');
        current.document = document;
        Object.assign(current, mirrored);
        current.updatedAt = Date.now();
        if (current.selectedSiteKeys)
          current.selectedSiteKeys = current.selectedSiteKeys.filter((key) =>
            document.sites.some((site) => site.key === key)
          );
      } else {
        if (settings.Subscriptions.some((entry) => entry.url === url))
          throw new Error('此订阅地址已添加');
        if (settings.Subscriptions.length >= 20)
          throw new Error('最多添加 20 个订阅');
        settings.Subscriptions.push({
          id: randomUUID(),
          name,
          url,
          enabled: true,
          updatedAt: Date.now(),
          document,
          ...mirrored,
        });
      }
      message = `订阅已${existing ? '更新' : '添加'}，共 ${
        document.sites.length
      } 个站点`;
      if (mirrored.assetErrors?.length)
        message += `；${mirrored.assetErrors.length} 个文件下载失败，可重试`;
    } else if (body.action === 'catalog') {
      if (typeof body.enabled !== 'boolean')
        throw new Error('首页开关参数无效');
      settings.CatalogEnabled = body.enabled;
    } else if (body.action === 'options') {
      for (const key of ['LocalAssetsEnabled', 'FilterCloudDrive'] as const) {
        if (body[key] !== undefined) {
          if (typeof body[key] !== 'boolean') throw new Error('开关参数无效');
          settings[key] = body[key];
        }
      }
    } else {
      const subscription = settings.Subscriptions.find(
        (entry) => entry.id === body.id
      );
      if (!subscription) throw new Error('订阅不存在');
      if (body.action === 'mirror') {
        const mirrored = await mirrorTVBoxAssets(
          subscription.document,
          subscription.assets,
          subscription.url
        );
        config = await getConfig();
        settings = editableSettings(config);
        const current = settings.Subscriptions.find(
          (entry) => entry.id === subscription.id
        );
        if (!current || current.updatedAt !== subscription.updatedAt)
          throw new Error('订阅已更新，请重新下载源文件');
        Object.assign(current, mirrored);
        message = `已保存 ${mirrored.assets.length} 个源文件${
          mirrored.assetErrors.length
            ? `，${mirrored.assetErrors.length} 个下载失败，可重试`
            : ''
        }`;
      } else if (body.action === 'remove') {
        settings.Subscriptions = settings.Subscriptions.filter(
          (entry) => entry.id !== body.id
        );
        message = '订阅已移除';
      } else if (body.action === 'update') {
        if (typeof body.enabled === 'boolean')
          subscription.enabled = body.enabled;
        if (body.selectedSiteKeys !== undefined) {
          if (
            !Array.isArray(body.selectedSiteKeys) ||
            body.selectedSiteKeys.some(
              (key: unknown) =>
                typeof key !== 'string' ||
                !subscription.document.sites.some((site) => site.key === key)
            )
          )
            throw new Error('所选站点无效');
          subscription.selectedSiteKeys = Array.from(
            new Set(body.selectedSiteKeys as string[])
          );
        }
      } else if (body.action === 'import-cms') {
        const selected = new Set(
          subscription.selectedSiteKeys ||
            subscription.document.sites.map((site) => site.key)
        );
        const sites = subscription.document.sites.filter(
          (site) =>
            selected.has(site.key) &&
            isCMSImportable(site) &&
            (settings.FilterCloudDrive === false || !cloudDriveReason(site))
        );
        if (!sites.length)
          throw new Error('所选站点没有可采集的标准 JSON CMS 源');
        const sources = [...config.SourceConfig];
        let count = 0;
        for (const site of sites) {
          const key = cmsImportKey(subscription.id, site);
          const existingSource = sources.find((source) => source.key === key);
          if (existingSource) {
            const position = sources.indexOf(existingSource);
            sources[position] = {
              ...existingSource,
              api: site.api,
              name: `${subscription.name} · ${site.name}`,
            };
            count++;
            continue;
          }
          if (sources.some((source) => source.api === site.api)) continue;
          sources.push({
            key,
            name: `${subscription.name} · ${site.name}`,
            api: site.api,
            from: 'custom',
            disabled: false,
          });
          count++;
        }
        config = { ...config, SourceConfig: sources };
        message = `已导入 ${count} 个 CMS 源，可在本地片库中选择并配置采集分类`;
      } else throw new Error('不支持的操作');
    }
    const next = { ...config, TVBoxConfig: settings };
    await db.saveAdminConfig(next);
    await setCachedConfig(next);
    return NextResponse.json({ settings, message });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
