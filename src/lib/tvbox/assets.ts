import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';

import { safeFetch } from '@/lib/safe-http';

import type { TVBoxAsset, TVBoxDocument, TVBoxSubscription } from './types';

const MAX_ASSETS = 64;
const MAX_TOTAL = 128 * 1024 * 1024;
const staticFile = /\.(?:js|mjs|cjs|py|json|txt|m3u)(?:[?;#]|$)/i;

function directory() {
  if (
    process.env.CF_PAGES ||
    process.env.VERCEL ||
    process.env.NETLIFY ||
    process.env.EDGEONE_PAGES ||
    ['edgeone', 'cloudflare'].includes(process.env.BUILD_TARGET || '')
  )
    throw new Error('本地源文件需要具有持久磁盘的 Node 服务');
  return (
    process.env.TVBOX_ASSET_DIR ||
    path.join(process.cwd(), '.data', 'tvbox', 'assets')
  );
}

function remoteFile(value: string) {
  const [url] = value.split(';');
  return /^https?:\/\//i.test(url) ? url : null;
}

function candidates(document: TVBoxDocument) {
  const files = new Map<string, TVBoxAsset['kind']>();
  const add = (value: unknown, kind?: TVBoxAsset['kind']) => {
    if (typeof value !== 'string') return;
    const url = remoteFile(value);
    if (url && (kind || staticFile.test(url)))
      files.set(
        url,
        kind || (/\.(?:[cm]?js|py)(?:[?#]|$)/i.test(url) ? 'script' : 'config')
      );
  };
  const nested = (value: unknown) => {
    if (typeof value === 'string') add(value);
    else if (Array.isArray(value)) value.forEach(nested);
    else if (value && typeof value === 'object')
      Object.values(value).forEach(nested);
  };
  add(document.spider, 'jar');
  for (const site of document.sites) {
    add(site.jar, 'jar');
    if (site.type === 3) add(site.api, 'script');
    nested(site.ext);
  }
  for (const field of ['lives', 'rules', 'headers', 'doh'] as const)
    nested(document[field]);
  return files;
}

export function scriptDependencies(source: string, url: string) {
  const result: string[] = [];
  const pattern =
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"](\.\.?\/[^'"\r\n]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const target = new URL(match[1], url).toString();
    if (staticFile.test(target)) result.push(target);
  }
  return result;
}

export async function mirrorTVBoxAssets(
  document: TVBoxDocument,
  previous: TVBoxAsset[] = [],
  subscriptionUrl?: string,
  refresh = false
) {
  const dir = directory();
  await mkdir(dir, { recursive: true });
  const queue = Array.from(candidates(document), ([url, kind]) => ({
    url,
    kind,
    depth: 0,
  }));
  const visited = new Set(queue.map((item) => item.url));
  const assets: TVBoxAsset[] = [];
  const errors: string[] = [];
  let total = 0;
  for (let offset = 0; offset < queue.length && offset < MAX_ASSETS; ) {
    const batch = queue.slice(offset, Math.min(offset + 3, MAX_ASSETS));
    offset += batch.length;
    await Promise.all(
      batch.map(async ({ url, kind, depth }) => {
        try {
          const max = (kind === 'jar' ? 48 : 4) * 1024 * 1024;
          const old = previous.find((asset) => asset.url === url);
          let cached: Buffer | null = null;
          if (old && !refresh) {
            try {
              const bytes = await readFile(path.join(dir, old.id));
              if (createHash('sha256').update(bytes).digest('hex') === old.id)
                cached = bytes;
            } catch {
              /* Missing files are downloaded again. */
            }
          }
          const response = cached
            ? null
            : await safeFetch(url, {
                headers: { 'User-Agent': 'okhttp/4.12.0', Accept: '*/*' },
                signal: AbortSignal.timeout(30000),
                size: max,
              } as RequestInit);
          if (response && !response.ok)
            throw new Error(`HTTP ${response.status}`);
          const bytes =
            cached || Buffer.from(await (response as Response).arrayBuffer());
          if (
            !bytes.length ||
            bytes.length > max ||
            total + bytes.length > MAX_TOTAL
          )
            throw new Error('源文件大小超出限制');
          total += bytes.length;
          const id = createHash('sha256').update(bytes).digest('hex');
          const originalName = path.basename(new URL(url).pathname);
          const name =
            originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) ||
            `source.${
              kind === 'jar' ? 'jar' : kind === 'script' ? 'js' : 'json'
            }`;
          const asset: TVBoxAsset = {
            id,
            url,
            resolvedUrl: response?.url || old?.resolvedUrl || url,
            name,
            kind,
            size: bytes.length,
            contentType:
              response?.headers.get('content-type') ||
              old?.contentType ||
              'application/octet-stream',
          };
          const temporary = path.join(dir, `${id}.${randomUUID()}.tmp`);
          await writeFile(temporary, bytes);
          await rename(temporary, path.join(dir, id));
          assets.push(asset);
          if (kind === 'script' && depth < 4)
            for (const dependency of scriptDependencies(
              bytes.toString('utf8'),
              asset.resolvedUrl || url
            )) {
              if (!visited.has(dependency) && visited.size < MAX_ASSETS) {
                visited.add(dependency);
                queue.push({
                  url: dependency,
                  kind: /\.(?:json|txt)(?:[?#]|$)/i.test(dependency)
                    ? 'config'
                    : 'script',
                  depth: depth + 1,
                });
              }
            }
        } catch (error) {
          errors.push(`${url}：${(error as Error).message}`);
          const old = previous.find((asset) => asset.url === url);
          if (old) {
            try {
              await readFile(path.join(dir, old.id));
              assets.push(old);
            } catch {
              /* The previous file is no longer present. */
            }
          }
        }
      })
    );
  }
  if (queue.length > MAX_ASSETS)
    errors.push(`源文件超过 ${MAX_ASSETS} 个，剩余文件保留原地址`);
  if (subscriptionUrl) {
    const bytes = Buffer.from(JSON.stringify(document, null, 2));
    const id = createHash('sha256').update(bytes).digest('hex');
    const temporary = path.join(dir, `${id}.${randomUUID()}.tmp`);
    await writeFile(temporary, bytes);
    await rename(temporary, path.join(dir, id));
    assets.push({
      id,
      url: subscriptionUrl,
      name: 'subscription.json',
      kind: 'config',
      size: bytes.length,
      contentType: 'application/json; charset=utf-8',
    });
  }
  return { assets, assetErrors: errors, assetsUpdatedAt: Date.now() };
}

export function localAssetUrl(asset: TVBoxAsset, base: string, token: string) {
  return `${base}/api/tvbox/assets/${encodeURIComponent(token)}/${
    asset.id
  }/${encodeURIComponent(asset.name)}`;
}

export function localizeTVBoxDocument(
  subscription: TVBoxSubscription,
  base: string,
  token: string
): TVBoxDocument {
  const files = new Map(
    (subscription.assets || []).map((asset) => [asset.url, asset])
  );
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const [url, ...suffix] = value.split(';');
      const asset = files.get(url);
      return asset
        ? [localAssetUrl(asset, base, token), ...suffix].join(';')
        : value;
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, replace(child)])
      );
    return value;
  };
  return replace(subscription.document) as TVBoxDocument;
}

export async function readTVBoxAsset(
  asset: TVBoxAsset,
  subscription: TVBoxSubscription,
  base: string,
  token: string
) {
  const bytes = await readFile(path.join(directory(), asset.id));
  if (asset.kind === 'jar') return bytes;
  if (asset.name === 'subscription.json' && asset.url === subscription.url)
    return Buffer.from(
      JSON.stringify(localizeTVBoxDocument(subscription, base, token))
    );
  const map = new Map(
    (subscription.assets || []).map((item) => [item.url, item])
  );
  const text = bytes.toString('utf8');
  const rewritten = text.replace(
    /(['"])([^'"\r\n]+)\1/g,
    (match, quote, value: string) => {
      let url: string;
      try {
        url = new URL(value, asset.resolvedUrl || asset.url).toString();
      } catch {
        return match;
      }
      const target = map.get(url);
      return target
        ? `${quote}${localAssetUrl(target, base, token)}${quote}`
        : match;
    }
  );
  return Buffer.from(rewritten);
}
