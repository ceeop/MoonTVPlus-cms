import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { filterAdsFromM3U8 } from '@/lib/hls-ad-filter';
import { filterUnmarkedHlsAds } from '@/lib/server/hls-ad-analysis';
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';
import { TVBOX_HLS_PATH, tvboxHlsParams, tvboxHlsUrl } from '@/lib/tvbox/hls';

export const runtime = 'nodejs';

export const maxDuration = 60; // 设置最大执行时间为 60 秒

async function readPlaylistText(response: Response, sniff: boolean) {
  if (!response.body?.getReader) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (size <= 4 * 1024 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) throw new Error('M3U8 播放清单超过大小限制');
      text += decoder.decode(value, { stream: true });
      if (
        sniff &&
        text.trimStart().length >= 7 &&
        !text.trimStart().startsWith('#EXTM3U')
      )
        return null;
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
  }
}

/**
 * M3U8 代理接口
 * 用于外部播放器访问,会执行去广告逻辑并处理相对链接
 * GET /api/proxy-m3u8?url=<原始m3u8地址>&source=<播放源>&token=<鉴权token>
 */
export async function GET(request: NextRequest) {
  try {
    const requestUrl = new URL(request.url);
    const tvbox = requestUrl.pathname === TVBOX_HLS_PATH;
    const searchParams = tvbox
      ? tvboxHlsParams(requestUrl.searchParams.get('id'))
      : requestUrl.searchParams;
    if (!searchParams) {
      return NextResponse.json(
        { error: '无效的播放清单地址' },
        { status: 400 }
      );
    }
    const m3u8Url = searchParams.get('url');
    const source = searchParams.get('source') || '';
    const token = searchParams.get('token');
    const adBlockEnabled = searchParams.get('adblock') !== 'false';
    const proxySegments = searchParams.get('proxySegments') === 'true';
    let analyzeSegments = searchParams.get('analysis') !== 'false';

    // Token 鉴权：如果环境变量设置了 token，则必须验证
    const envToken = process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN;
    if (envToken && envToken.trim() !== '') {
      if (!token || token !== envToken) {
        return NextResponse.json({ error: '无效的访问令牌' }, { status: 401 });
      }
    }

    if (!m3u8Url) {
      return NextResponse.json({ error: '缺少必要参数: url' }, { status: 400 });
    }

    const DIRECT_PLAY_SOURCE = 'directplay';
    // 安全校验：防 SSRF / 域名重绑定，只允许合法的公网 URL。对所有经过 proxy-m3u8 的请求强制校验，不仅限于 directplay
    const isSafeUrl = await validateProxyUrlServerSide(m3u8Url);
    if (!isSafeUrl) {
      return NextResponse.json(
        { error: 'Proxy request to local or invalid network is forbidden' },
        { status: 403 }
      );
    }

    // 获取当前请求的 origin
    // 优先级：SITE_BASE 环境变量 > 从请求头构建
    let origin = process.env.SITE_BASE;
    if (!origin) {
      // 从请求头中获取 Host 和协议
      let host =
        request.headers.get('x-forwarded-host') || request.headers.get('host');

      // 安全校验：防 Host 头注入漏洞 (要求仅包含合法域名或 IP 格式字符)
      if (host && !/^[a-zA-Z0-9.-]+(:\d+)?$/.test(host)) {
        host = null;
      }

      // Fallback：如果以上 Header 无效或未提供，回退到 request.url 获取
      if (!host) {
        try {
          host = new URL(request.url).host;
        } catch {
          return NextResponse.json(
            { error: 'Invalid Request Host' },
            { status: 400 }
          );
        }
      }

      const proto =
        request.headers.get('x-forwarded-proto') ||
        new URL(request.url).protocol.replace(':', '');
      origin = `${proto}://${host}`;
    }

    // 获取原始 m3u8 内容
    const m3u8UrlObj = new URL(m3u8Url);
    const response = await fetch(m3u8Url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        Referer: `${m3u8UrlObj.protocol}//${m3u8UrlObj.host}/`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: '获取 m3u8 文件失败' },
        { status: response.status }
      );
    }

    // 后端 MIME Sniffing: 防御伪装成 m3u8 的大文件二进制流
    // 使用白名单策略：只有明确属于文本/m3u8 类型的才放行解析
    const contentType = (
      response.headers.get('content-type') || ''
    ).toLowerCase();
    const sniffPlaylist =
      contentType.includes('octet-stream') &&
      /\.m3u8$/i.test(new URL(response.url || m3u8Url).pathname);
    const isTextType =
      sniffPlaylist ||
      contentType === '' || // 无 Content-Type 时保守放行（后续有内容校验兜底）
      contentType.includes('application/vnd.apple.mpegurl') || // 标准 m3u8
      contentType.includes('application/x-mpegurl') || // 兼容 m3u8
      contentType.includes('audio/mpegurl') || // 兼容 m3u8
      contentType.includes('text/') || // text/plain 等
      contentType.includes('application/json'); // 部分 API 返回 JSON 格式的错误

    if (!isTextType) {
      if (source === DIRECT_PLAY_SOURCE) {
        console.log(
          `[Proxy-M3U8] 检测到非文本媒体流 (Content-Type: ${contentType}), 针对 directplay 直链代理模式，直接透传二进制流, URL: ${m3u8Url}`
        );
        // 构造一个新的 Response 对象用于二进制直接透传，确保包含了支持跨域的 header
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');

        // 如果源站返回了跨站相关的禁止头，尽量移除它们
        newHeaders.delete('X-Frame-Options');
        newHeaders.delete('Content-Security-Policy');

        return new NextResponse(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }

      console.warn(
        `[Proxy-M3U8] 拦截到非文本媒体流 (Content-Type: ${contentType}), 拒绝按文本解析, URL: ${m3u8Url}`
      );
      return NextResponse.json(
        {
          error: 'Unsupported Media Type',
          details: `The source returned Content-Type "${contentType}", which is not a text m3u8 playlist.`,
          fallbackToDirect: true,
          originalUrl: m3u8Url,
        },
        { status: 415, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    let m3u8Content = await readPlaylistText(response, sniffPlaylist);
    if (
      m3u8Content === null ||
      (sniffPlaylist && !m3u8Content.trimStart().startsWith('#EXTM3U'))
    ) {
      return NextResponse.json(
        {
          error: 'Unsupported Media Type',
          fallbackToDirect: true,
          originalUrl: m3u8Url,
        },
        { status: 415, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // 二次内容校验：即使 Content-Type 通过了白名单，检查实际内容是否为有效的 m3u8
    // 有些服务器返回 text/plain 但实际内容是 HTML 错误页或其他格式
    const trimmedContent = m3u8Content.trimStart();
    if (
      trimmedContent.length > 0 &&
      !trimmedContent.startsWith('#EXTM3U') &&
      !trimmedContent.startsWith('#EXT')
    ) {
      console.warn(
        `[Proxy-M3U8] 内容校验失败：响应体不以 #EXTM3U 或 #EXT 开头, 可能非有效 m3u8, URL: ${m3u8Url}`
      );
      // 不直接拒绝（可能是不规范但仍可播放的 m3u8），仅打印警告继续处理
    }

    // 执行去广告逻辑；原生 HLS 可通过 adblock=false 保留代理但关闭过滤。
    // Separate audio renditions need coordinated edits; retain text-only filtering there.
    if (
      /^#EXT-X-MEDIA:(?=[^\r\n]*TYPE=AUDIO)(?=[^\r\n]*URI=)/m.test(m3u8Content)
    )
      analyzeSegments = false;
    if (adBlockEnabled) {
      const config = await getConfig(true);
      const customAdFilterCode = config.SiteConfig?.CustomAdFilterCode || '';

      m3u8Content = filterAdsFromM3U8(source, m3u8Content, customAdFilterCode);
      if (analyzeSegments && !customAdFilterCode.trim()) {
        m3u8Content = await filterUnmarkedHlsAds(
          m3u8Content,
          response.url || m3u8Url
        );
      }
    }

    // 处理 m3u8 中的相对链接
    m3u8Content = resolveM3u8Links(
      m3u8Content,
      response.url || m3u8Url,
      source,
      origin,
      token || '',
      adBlockEnabled,
      proxySegments,
      analyzeSegments,
      tvbox
    );

    // 返回处理后的 m3u8 内容
    return new NextResponse(m3u8Content, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('代理 m3u8 失败:', error);
    return NextResponse.json(
      { error: '代理失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * 将 m3u8 中的相对链接转换为绝对链接，并将子 m3u8 链接转为代理链接。
 * 此函数仅在代理模式下由服务端调用。
 * - 子 m3u8 链接 → 指向 /api/proxy-m3u8（递归代理）
 * - ts 分片/密钥 → directplay 或 proxySegments 模式指向 /api/proxy/vod/segment
 */
function resolveM3u8Links(
  m3u8Content: string,
  baseUrl: string,
  source: string,
  proxyOrigin: string,
  token: string,
  adBlockEnabled: boolean,
  proxySegments: boolean,
  analyzeSegments: boolean,
  tvbox: boolean
): string {
  const lines = m3u8Content.split(/\r?\n/);
  const base = new URL(baseUrl);
  const fullProxy = source === 'directplay' || proxySegments;
  const playlistUrl = (url: string) => {
    const proxy = new URL('/api/proxy-m3u8', proxyOrigin);
    proxy.searchParams.set('url', url);
    if (source) proxy.searchParams.set('source', source);
    if (token) proxy.searchParams.set('token', token);
    if (!adBlockEnabled) proxy.searchParams.set('adblock', 'false');
    if (proxySegments) proxy.searchParams.set('proxySegments', 'true');
    if (!analyzeSegments) proxy.searchParams.set('analysis', 'false');
    return tvbox
      ? tvboxHlsUrl(proxyOrigin, proxy.searchParams)
      : proxy.toString();
  };
  const mediaUrl = (url: string) => {
    if (!fullProxy || !/^https?:/i.test(url)) return url;
    const proxy = new URL('/api/proxy/vod/segment', proxyOrigin);
    proxy.searchParams.set('url', url);
    proxy.searchParams.set('source', source);
    return proxy.toString();
  };
  let isNextLinePlaylist = false;

  return lines
    .map((original) => {
      const line = original.trim();
      if (!line) return original;
      if (line.startsWith('#')) {
        if (line.startsWith('#EXT-X-STREAM-INF:')) isNextLinePlaylist = true;
        // Audio/subtitle renditions also have playlists and must pass filtering.
        const isPlaylistTag =
          /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(line);
        const isMediaTag =
          /^#EXT-X-(?:KEY|SESSION-KEY|MAP|PART|PRELOAD-HINT):/.test(line);
        if (isPlaylistTag || isMediaTag) {
          return original.replace(/\bURI="([^"]+)"/g, (_match, uri: string) => {
            const url = new URL(uri, base).href;
            return `URI="${isPlaylistTag ? playlistUrl(url) : mediaUrl(url)}"`;
          });
        }
        return original;
      }
      const url = new URL(line, base).href;
      const isPlaylist =
        isNextLinePlaylist || /\.m3u8$/i.test(new URL(url).pathname);
      isNextLinePlaylist = false;
      return isPlaylist ? playlistUrl(url) : mediaUrl(url);
    })
    .join('\n');
}
