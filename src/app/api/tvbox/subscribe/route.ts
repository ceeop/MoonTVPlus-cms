/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAvailableApiSites, getConfig } from '@/lib/config';
import { getCachedLiveChannels } from '@/lib/live';
import { hasFeaturePermission } from '@/lib/permissions';
import {
  authorizeTVBox,
  TVBoxAccessError,
  tvboxBaseUrl,
} from '@/lib/tvbox/access';
import { cloudFilterEnabled } from '@/lib/tvbox/cloud-filter';
import { exportTVBoxSubscriptions } from '@/lib/tvbox/export';
import { BUILTIN_TVBOX_SOURCES, tvboxSourceUrl } from '@/lib/tvbox/source-url';
import { tvboxSettings } from '@/lib/tvbox/subscriptions';

export const runtime = 'nodejs';

/**
 * TVBOX订阅API
 * 根据视频源和直播源生成TVBOX订阅
 * 支持全局token（管理员）和用户token（普通用户）
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');
  const adFilter = searchParams.get('adFilter') === 'true'; // 获取去广告参数
  const yellowFilter = searchParams.get('yellowFilter') === 'true';

  try {
    const access = await authorizeTVBox(token);
    const username = access.username;
    const isGlobalToken = access.global;
    // authorizeTVBox rejects empty tokens before any subscription URLs are built.
    const subscribeToken = token as string;
    // 获取配置
    const config = await getConfig(true);
    const m3u8Only = config.SiteConfig?.M3u8Only === true;

    // 获取视频源
    // 全局token返回所有源，用户token返回该用户有权限的源
    const apiSites = await getAvailableApiSites(username);

    // 获取直播源
    const canAccessLive =
      isGlobalToken || !username
        ? true
        : await hasFeaturePermission(username, 'live');
    const liveConfig = canAccessLive
      ? config.LiveConfig?.filter((live) => !live.disabled) || []
      : [];

    const baseUrl = tvboxBaseUrl(request);

    console.log(
      'TVBOX 订阅 baseUrl:',
      baseUrl,
      'adFilter:',
      adFilter,
      'yellowFilter:',
      yellowFilter
    );

    // 检查是否配置了 OpenList
    const hasOpenList = !!(
      config.OpenListConfig?.Enabled &&
      config.OpenListConfig?.URL &&
      config.OpenListConfig?.Username &&
      config.OpenListConfig?.Password
    );

    // 获取所有启用的 Emby 源
    const { embyManager } = await import('@/lib/emby-manager');
    const embySources = await embyManager.getEnabledSources();

    // 构建 OpenList 站点配置
    const openlistSites =
      !m3u8Only && hasOpenList
        ? [
            {
              key: 'openlist',
              name: '私人影库',
              type: 1,
              api: `${baseUrl}/api/openlist/cms-proxy/${encodeURIComponent(
                subscribeToken
              )}`,
              searchable: 1,
              quickSearch: 1,
              filterable: 1,
              ext: '',
            },
          ]
        : [];

    // 构建 Emby 站点配置（为每个启用的Emby源生成独立站点）
    const embySites = (m3u8Only ? [] : embySources).map((source) => ({
      key: `emby_${source.key}`,
      name: source.name || 'Emby媒体库',
      type: 1,
      api: `${baseUrl}/api/emby/cms-proxy/${encodeURIComponent(
        subscribeToken
      )}?embyKey=${source.key}`,
      searchable: 1,
      quickSearch: 1,
      filterable: 1,
      ext: '',
    }));

    const settings = tvboxSettings(config);
    settings.FilterCloudDrive = cloudFilterEnabled(
      searchParams.get('cloudFilter'),
      settings.FilterCloudDrive !== false
    );
    const catalogSites =
      config.CatalogConfig?.Enabled && settings.CatalogEnabled
        ? [
            {
              key: 'moontv_catalog',
              name: 'MoonTV · 聚合片库',
              type: 1,
              api: `${baseUrl}/api/tvbox/catalog/${encodeURIComponent(
                subscribeToken
              )}?adFilter=${adFilter}&yellowFilter=${yellowFilter}`,
              searchable: 1,
              quickSearch: 1,
              filterable: 1,
              changeable: 1,
            },
          ]
        : [];
    const external = exportTVBoxSubscriptions(
      settings,
      [
        'moontv_catalog',
        ...openlistSites.map((site) => site.key),
        ...embySites.map((site) => site.key),
        ...apiSites.map((site) => site.key),
      ],
      baseUrl,
      subscribeToken,
      adFilter,
      yellowFilter,
      m3u8Only
    );

    // 构建TVBOX订阅数据
    const tvboxSubscription = {
      // 站点配置
      spider: external.spider || `${baseUrl}/tvbox/custom_spider.jar`,
      wallpaper: '',

      // 聚合片库首页优先，其后保留私人影库、普通源和外部站点。
      sites: [
        ...catalogSites,
        ...openlistSites,
        ...embySites,
        ...apiSites.map((site) => ({
          key: site.key,
          name: site.name,
          type: 1,
          api: tvboxSourceUrl(
            baseUrl,
            subscribeToken,
            BUILTIN_TVBOX_SOURCES,
            site.key,
            {
              adFilter,
              yellowFilter,
            }
          ),
          searchable: 1,
          quickSearch: 1,
          filterable: 1,
          ext: site.detail || '',
        })),
        ...external.sites,
      ],

      // 直播源
      lives: [
        ...(await Promise.all(
          liveConfig.map(async (live) => {
            try {
              const liveChannels = await getCachedLiveChannels(live.key);
              return {
                name: live.name,
                type: 0,
                url: live.url,
                epg: live.epg || liveChannels?.epgUrl || '',
                logo: '',
              };
            } catch (error) {
              return {
                name: live.name,
                type: 0,
                playerType: 1,
                url: live.url,
                epg: live.epg || '',
                logo: '',
              };
            }
          })
        )),
        ...(external.lives || []),
      ],

      // 解析器
      parses: external.parses || [],

      // 规则
      rules: external.rules || [],

      // 广告配置
      ads: external.ads || [],
      flags: external.flags || [],
      headers: external.headers || [],
      doh: external.doh || [],
      hosts: external.hosts || [],
    };

    // 获取屏蔽源列表并过滤
    const blockedSources = process.env.TVBOX_BLOCKED_SOURCES
      ? process.env.TVBOX_BLOCKED_SOURCES.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    if (blockedSources.length > 0) {
      tvboxSubscription.sites = tvboxSubscription.sites.filter(
        (site) => !blockedSources.includes(site.key)
      );
      console.log('TVBOX 订阅已屏蔽源:', blockedSources);
    }

    return NextResponse.json(tvboxSubscription, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    if (error instanceof TVBoxAccessError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    console.error('生成TVBOX订阅失败:', error);
    return NextResponse.json(
      {
        error: '生成订阅失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
