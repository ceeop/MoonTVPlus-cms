import type { TVBoxSite } from './types';

export function cloudDriveReason(site: TVBoxSite): string | null {
  const label = `${site.key} ${site.name}`;
  if (
    /网盘|網盤|云盘|雲盤|盘搜|盤搜|搜盘|搜盤|盘她|盘他|四盘|四盤|多盘|多盤|夸克|阿里盘|阿里盤|天翼云|天翼雲|玩偶|pikpak|quark|alipan|aliyundrive|pansearch|pansou|mydrive/i.test(
      label
    )
  )
    return '网盘播放、搜索或配置站点';
  // Inspect provider identity, not shared ext fields: many ordinary sites carry a Cloud-drive option.
  const identity = `${site.key} ${site.api}`;
  if (
    /csp_(?:mydrive|wogg|wobg|seedhub|ypanso|bpanso|s_zps|kkss|uuss|quark|ali(?:pan|yun)?|ucpan|pikpak|yunpan|pansearch|pansou|yunso)/i.test(
      identity
    )
  )
    return '网盘插件';
  return null;
}

export function cloudFilterEnabled(value: string | null, fallback = true) {
  return value === null ? fallback : value === 'true';
}
