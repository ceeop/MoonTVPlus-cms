/* Browser HLS loader and custom-rule cache. Filtering is shared with TVBox. */

import { filterAdsFromM3U8 } from './hls-ad-filter';
import { isServerFilteredHlsUrl } from './hls-playback-url';

export { filterAdsFromM3U8 } from './hls-ad-filter';

/**
 * 生成去广告用的 hls.js loader 类。getSource/getCustomCode 用闭包传，
 * 这样 loader 每次请求都能拿到最新的源名和自定义规则。
 * 返回类型写成 any：HlsLib 是动态 import 的，基类拿不到类型，
 * 硬标成 hls.js 的 Loader 会因为缺成员而编译不过。
 */
export function createAdFilteringHlsLoader(
  HlsLib: any,
  getSource: () => string,
  getCustomCode: () => string
): any {
  return class CustomHlsJsLoader extends HlsLib.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        // Audio and subtitle renditions have their own playlists as well.
        if (
          ['manifest', 'level', 'audioTrack', 'subtitleTrack'].includes(
            context?.type
          )
        ) {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            ctx: any,
            networkDetails: any
          ) {
            const serverFiltered = isServerFilteredHlsUrl(
              ctx?.url || response.url || '',
              typeof window === 'undefined'
                ? 'http://localhost'
                : window.location.origin
            );
            if (
              !serverFiltered &&
              response.data &&
              typeof response.data === 'string'
            ) {
              response.data = filterAdsFromM3U8(
                getSource(),
                response.data,
                getCustomCode()
              );
            }
            return onSuccess(response, stats, ctx, networkDetails);
          };
        }
        load(context, config, callbacks);
      };
    }
  };
}

/**
 * 取后台配置的自定义去广告代码（带 localStorage 缓存 + 版本号校验）。
 * 取不到就返回空串，走默认关键字规则。
 */
let pendingCode: { version: number; request: Promise<string> } | undefined;

export async function loadCustomAdFilterCode(): Promise<string> {
  if (typeof window === 'undefined') return '';
  const version = (window as any).RUNTIME_CONFIG?.CUSTOM_AD_FILTER_VERSION || 0;
  if (pendingCode && pendingCode.version === version)
    return pendingCode.request;
  const request = readCustomAdFilterCode(version);
  pendingCode = { version, request };
  try {
    return await request;
  } finally {
    if (pendingCode?.request === request) pendingCode = undefined;
  }
}

async function readCustomAdFilterCode(version: number): Promise<string> {
  let cachedCode: string | null = null;
  try {
    cachedCode = localStorage.getItem('custom_ad_filter_code_cache');
    const cachedVersion = localStorage.getItem(
      'custom_ad_filter_version_cache'
    );

    // 版本 0 = 后台没配，清缓存跳过
    if (version === 0) {
      localStorage.removeItem('custom_ad_filter_code_cache');
      localStorage.removeItem('custom_ad_filter_version_cache');
      return '';
    }

    if (
      cachedCode !== null &&
      cachedVersion &&
      parseInt(cachedVersion) === version
    ) {
      return cachedCode;
    }
  } catch {
    // Private browsing may block localStorage; fetching rules should still work.
  }
  if (!version) return '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('/api/ad-filter?full=true', {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return cachedCode || '';
    const { code, version: serverVersion } = await res.json();
    // An empty string is an intentional reset to the built-in rules.
    if (typeof code === 'string') {
      try {
        localStorage.setItem('custom_ad_filter_code_cache', code);
        localStorage.setItem(
          'custom_ad_filter_version_cache',
          String(serverVersion ?? version)
        );
      } catch {
        /* Playback does not depend on persistent storage. */
      }
      return code;
    }
    return cachedCode || '';
  } catch {
    return cachedCode || '';
  } finally {
    clearTimeout(timeout);
  }
}
