import type { NextRequest } from 'next/server';

import { catalogSettings } from '@/lib/catalog/model';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export class TVBoxAccessError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function authorizeTVBox(token: string | null) {
  if (process.env.ENABLE_TVBOX_SUBSCRIBE !== 'true')
    throw new TVBoxAccessError('订阅功能未开启', 403);
  if (!token) throw new TVBoxAccessError('缺少订阅 token', 401);
  if (
    process.env.TVBOX_SUBSCRIBE_TOKEN &&
    token === process.env.TVBOX_SUBSCRIBE_TOKEN
  )
    return { username: undefined, global: true };
  const username = await db.getUsernameByTvboxToken(token);
  if (!username) throw new TVBoxAccessError('无效的订阅 token', 401);
  const user = await db.getUserInfoV2(username);
  if (!user || user.banned)
    throw new TVBoxAccessError('用户不存在或已被封禁', 403);
  return { username, global: false };
}

export async function tvboxCatalogContext(token: string) {
  const access = await authorizeTVBox(token);
  const config = await getConfig(true);
  const settings = catalogSettings(config);
  if (!settings.Enabled || config.TVBoxConfig?.CatalogEnabled === false)
    throw new TVBoxAccessError('本地片库首页未开启', 404);
  const blocked = new Set(
    (process.env.TVBOX_BLOCKED_SOURCES || '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
  );
  const sites = (await getAvailableApiSites(access.username)).filter(
    (site) => settings.SourceKeys.includes(site.key) && !blocked.has(site.key)
  );
  return { ...access, config, settings, sites };
}

export function tvboxBaseUrl(request: NextRequest) {
  const configured =
    process.env.SITE_BASE || request.nextUrl.searchParams.get('origin');
  if (configured) {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('站点地址必须使用 HTTP 或 HTTPS');
    return url.origin;
  }
  const host =
    request.headers.get('x-forwarded-host') || request.headers.get('host');
  const protocol =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '');
  return host
    ? new URL(`${protocol}://${host}`).origin
    : request.nextUrl.origin;
}
