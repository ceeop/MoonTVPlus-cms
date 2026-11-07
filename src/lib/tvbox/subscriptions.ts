import { createDecipheriv, createHash } from 'crypto';

import type { AdminConfig } from '@/lib/admin.types';
import { safeFetch } from '@/lib/safe-http';

import { cloudDriveReason } from './cloud-filter';
import type { TVBoxDocument, TVBoxSettings, TVBoxSite } from './types';

const MAX_BYTES = 2 * 1024 * 1024;
const arrayFields = [
  'parses',
  'lives',
  'rules',
  'flags',
  'ads',
  'headers',
  'doh',
  'hosts',
] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function tvboxSettings(
  config: Pick<AdminConfig, 'TVBoxConfig'>
): TVBoxSettings {
  return {
    CatalogEnabled: config.TVBoxConfig?.CatalogEnabled !== false,
    LocalAssetsEnabled: config.TVBoxConfig?.LocalAssetsEnabled !== false,
    FilterCloudDrive: config.TVBoxConfig?.FilterCloudDrive !== false,
    Subscriptions: config.TVBoxConfig?.Subscriptions || [],
  };
}

export function httpSubscriptionUrl(value: string) {
  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('订阅地址必须为 HTTP 或 HTTPS 链接');
  return url.toString();
}

// TVBox configurations commonly include comments and trailing commas. Never evaluate them.
function jsonText(text: string) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      result += c;
      while (++i < text.length) {
        result += text[i];
        if (text[i] === '\\') result += text[++i] || '';
        else if (text[i] === '"') break;
      }
    } else if (c === '/' && text[i + 1] === '/') {
      while (i + 1 < text.length && !/[\r\n]/.test(text[i + 1])) i++;
      result += ' ';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('订阅中的注释未闭合');
      i = end + 1;
      result += ' ';
    } else result += c;
  }
  return result
    .replace(
      /("(?:\\.|[^"\\])*")|,\s*(?=[}\]])/g,
      (match, quoted) => quoted || ''
    )
    .replace(/^\uFEFF/, '')
    .trim();
}

export function decodeTVBoxDocument(input: Buffer | string): unknown {
  let text = typeof input === 'string' ? input : input.toString('utf8');
  if (
    !text
      .trimStart()
      .replace(/^\uFEFF/, '')
      .startsWith('{')
  ) {
    const marker = /[A-Za-z0-9]{8}\*\*/.exec(text);
    if (marker)
      text = Buffer.from(
        text.slice(marker.index + marker[0].length),
        'base64'
      ).toString('utf8');
    if (text.startsWith('2423')) {
      const hex = text.replace(/\s/g, '');
      const decoded = Buffer.from(hex, 'hex').toString('utf8').toLowerCase();
      const key = /\$#(.*?)#\$/.exec(decoded)?.[1];
      const start = hex.indexOf('2324');
      if (!key || key.length > 16 || start < 0)
        throw new Error('无法解析订阅编码');
      const decipher = createDecipheriv(
        'aes-128-cbc',
        Buffer.from(key.padEnd(16, '0')),
        Buffer.from(decoded.slice(-13).padEnd(16, '0'))
      );
      text = Buffer.concat([
        decipher.update(Buffer.from(hex.slice(start + 4, -26), 'hex')),
        decipher.final(),
      ]).toString('utf8');
    }
  }
  try {
    return JSON.parse(jsonText(text));
  } catch {
    throw new Error(
      '订阅未返回可识别的 TVBox JSON 配置，请检查地址或客户端访问限制'
    );
  }
}

function resource(value: unknown, base: string, bare = false): unknown {
  if (typeof value !== 'string' || !value) return value;
  const [path, ...suffix] = value.split(';');
  if (/^(?:\.\.?\/|\/)/.test(path) || (bare && !/^[\w+.-]+:/.test(path)))
    return [new URL(path, base).toString(), ...suffix].join(';');
  return value;
}

function nestedResources(value: unknown, base: string): unknown {
  if (typeof value === 'string') return resource(value, base);
  if (Array.isArray(value))
    return value.map((item) => nestedResources(item, base));
  if (object(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        nestedResources(item, base),
      ])
    );
  return value;
}

export function normalizeTVBoxDocument(
  value: unknown,
  base: string
): TVBoxDocument {
  if (!object(value) || !Array.isArray(value.sites)) {
    if (object(value) && Array.isArray(value.urls))
      throw new Error('这是多线路订阅，请选择其中一个具体线路地址导入');
    throw new Error('订阅缺少 sites 站点列表');
  }
  const spider = resource(value.spider, base, true) as string | undefined;
  const keys = new Set<string>();
  const sites = value.sites.slice(0, 1000).map((raw): TVBoxSite => {
    if (
      !object(raw) ||
      typeof raw.key !== 'string' ||
      typeof raw.api !== 'string'
    )
      throw new Error('订阅站点缺少 key 或 api');
    if (keys.has(raw.key)) throw new Error(`订阅包含重复站点：${raw.key}`);
    keys.add(raw.key);
    const type = Number(raw.type ?? 0);
    if (![0, 1, 3, 4].includes(type))
      throw new Error(`站点 ${raw.key} 的类型不受支持`);
    const site = {
      ...raw,
      key: raw.key,
      name: typeof raw.name === 'string' ? raw.name : raw.key,
      type,
      api: resource(
        raw.api,
        base,
        type !== 3 || !raw.api.startsWith('csp_')
      ) as string,
      ext: nestedResources(raw.ext, base),
    } as TVBoxSite;
    const jar = resource(raw.jar || spider, base, true);
    if (typeof jar === 'string' && jar) site.jar = jar;
    if (raw.playUrl) site.playUrl = resource(raw.playUrl, base);
    return site;
  });
  if (!sites.length) throw new Error('订阅没有可用站点');
  const document: TVBoxDocument = { sites, ...(spider ? { spider } : {}) };
  for (const key of arrayFields) {
    if (Array.isArray(value[key]))
      (document as unknown as Record<string, unknown>)[key] = nestedResources(
        value[key],
        base
      );
    else if (
      typeof value[key] === 'string' &&
      ['headers', 'doh', 'rules'].includes(key)
    )
      (document as unknown as Record<string, unknown>)[key] = [
        resource(value[key], base, true),
      ];
  }
  return document;
}

export async function fetchTVBoxSubscription(url: string) {
  const response = await safeFetch(httpSubscriptionUrl(url), {
    headers: { 'User-Agent': 'okhttp/4.12.0', Accept: '*/*' },
    signal: AbortSignal.timeout(20000),
    size: MAX_BYTES,
  } as RequestInit);
  if (!response.ok) throw new Error(`订阅请求失败（HTTP ${response.status}）`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('订阅配置超过 2 MiB');
  return normalizeTVBoxDocument(
    decodeTVBoxDocument(bytes),
    response.url || url
  );
}

export function cmsImportKey(subscriptionId: string, site: TVBoxSite) {
  return `tvbox_${subscriptionId.replace(/-/g, '').slice(0, 12)}_${createHash(
    'sha256'
  )
    .update(site.key)
    .digest('hex')
    .slice(0, 12)}`;
}

export function isCMSImportable(site: TVBoxSite) {
  return site.type === 1 && /^https?:\/\//i.test(site.api) && !site.playUrl;
}

export function mergeTVBoxSubscriptions(
  settings: TVBoxSettings,
  existingKeys: string[] = []
) {
  const merged: TVBoxDocument = { sites: [] };
  const used = new Set(existingKeys);
  for (const subscription of settings.Subscriptions.filter(
    (entry) => entry.enabled
  )) {
    const selected = subscription.selectedSiteKeys
      ? new Set(subscription.selectedSiteKeys)
      : null;
    const sites = subscription.document.sites.filter(
      (site) =>
        (!selected || selected.has(site.key)) &&
        (settings.FilterCloudDrive === false || !cloudDriveReason(site))
    );
    if (!sites.length) continue;
    if (!merged.spider && subscription.document.spider)
      merged.spider = subscription.document.spider;
    for (const site of sites) {
      let key = site.key;
      if (used.has(key)) key = `${subscription.id}:${key}`;
      while (used.has(key)) key += '_';
      used.add(key);
      merged.sites.push({ ...site, key });
    }
    for (const key of arrayFields) {
      const previous = (merged[key] || []) as unknown[];
      const additions = (subscription.document[key] || []) as unknown[];
      const unique = new Map(
        [...previous, ...additions].map((value) => [
          JSON.stringify(value),
          value,
        ])
      );
      (merged as unknown as Record<string, unknown>)[key] = Array.from(
        unique.values()
      );
    }
  }
  return merged;
}
