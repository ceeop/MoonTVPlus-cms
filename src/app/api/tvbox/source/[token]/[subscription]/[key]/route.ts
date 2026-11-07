import { NextRequest, NextResponse } from 'next/server';

import { getAvailableApiSites, getConfig } from '@/lib/config';
import { parseJsonLosslessIntegers } from '@/lib/json';
import { safeFetch } from '@/lib/safe-http';
import {
  authorizeTVBox,
  TVBoxAccessError,
  tvboxBaseUrl,
} from '@/lib/tvbox/access';
import { cloudDriveReason, cloudFilterEnabled } from '@/lib/tvbox/cloud-filter';
import { filterTVBoxCMS } from '@/lib/tvbox/cms';
import { BUILTIN_TVBOX_SOURCES } from '@/lib/tvbox/source-url';
import { isCMSImportable, tvboxSettings } from '@/lib/tvbox/subscriptions';
import type { TVBoxSite } from '@/lib/tvbox/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string; subscription: string; key: string } }
) {
  try {
    const access = await authorizeTVBox(params.token);
    const config = await getConfig(true);
    const m3u8Only = config.SiteConfig?.M3u8Only === true;
    const searchParams = request.nextUrl.searchParams;
    const builtin = params.subscription === BUILTIN_TVBOX_SOURCES;
    let site: TVBoxSite | undefined;
    if (builtin) {
      const blocked = (process.env.TVBOX_BLOCKED_SOURCES || '')
        .split(',')
        .map((key) => key.trim());
      if (!blocked.includes(params.key)) {
        const configured = (await getAvailableApiSites(access.username)).find(
          (entry) => entry.key === params.key
        );
        if (configured) site = { ...configured, type: 1 };
      }
    } else {
      const settings = tvboxSettings(config);
      const subscription = settings.Subscriptions.find(
        (entry) => entry.id === params.subscription && entry.enabled
      );
      const cloudFilter = cloudFilterEnabled(
        searchParams.get('cloudFilter'),
        settings.FilterCloudDrive !== false
      );
      site = subscription?.document.sites.find(
        (entry) =>
          entry.key === params.key &&
          entry.type === 1 &&
          (!subscription.selectedSiteKeys ||
            subscription.selectedSiteKeys.includes(entry.key)) &&
          (!cloudFilter || !cloudDriveReason(entry)) &&
          (!m3u8Only || isCMSImportable(entry))
      );
    }
    if (!site)
      return NextResponse.json({ error: '站点未启用' }, { status: 404 });
    const target = new URL(site.api);
    if (!['http:', 'https:'].includes(target.protocol))
      throw new Error('源地址协议无效');
    searchParams.forEach((value, key) => {
      if (
        ![
          'adFilter',
          'yellowFilter',
          'cloudFilter',
          'm3u8Only',
          'origin',
        ].includes(key)
      )
        target.searchParams.set(key, value);
    });
    if (site.ext && !target.searchParams.has('extend'))
      target.searchParams.set(
        'extend',
        typeof site.ext === 'string' ? site.ext : JSON.stringify(site.ext)
      );
    let headers: Record<string, unknown> = {};
    if (site.header && typeof site.header === 'object')
      headers = site.header as Record<string, unknown>;
    const response = await safeFetch(target.toString(), {
      signal: AbortSignal.timeout(15000),
      size: 4 * 1024 * 1024,
      headers: {
        'User-Agent': builtin
          ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          : 'okhttp/4.12.0',
        Accept: 'application/json',
        ...Object.fromEntries(
          Object.entries(headers).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        ),
      },
    } as RequestInit);
    if (!response.ok)
      return NextResponse.json(
        { error: `源请求失败（HTTP ${response.status}）` },
        { status: 502 }
      );
    const input = parseJsonLosslessIntegers(await response.text());
    return NextResponse.json(
      filterTVBoxCMS(
        input,
        tvboxBaseUrl(request),
        searchParams.get('adFilter') === 'true',
        searchParams.get('yellowFilter') === 'true',
        site.key,
        m3u8Only
      ),
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: error instanceof TVBoxAccessError ? error.status : 502 }
    );
  }
}
