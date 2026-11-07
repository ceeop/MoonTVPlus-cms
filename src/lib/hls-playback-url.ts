const AD_PROXY = '/api/proxy-m3u8';
const VOD_PROXY = '/api/proxy/vod/m3u8';

export function prepareHlsPlaybackUrl(
  input: string,
  options: {
    origin: string;
    source?: string;
    token?: string;
    adBlock: boolean;
    serverFilter?: boolean;
  }
) {
  try {
    const url = new URL(input, options.origin);
    const ownAdProxy =
      url.origin === new URL(options.origin).origin &&
      url.pathname === AD_PROXY;
    if (!ownAdProxy && !(options.adBlock && options.serverFilter !== false))
      return input;
    return buildHlsAdProxyUrl(input, options);
  } catch {
    return input;
  }
}

export function isServerFilteredHlsUrl(input: string, origin: string) {
  try {
    const url = new URL(input, origin);
    return (
      url.origin === new URL(origin).origin &&
      url.pathname === AD_PROXY &&
      url.searchParams.get('adblock') !== 'false'
    );
  } catch {
    return false;
  }
}

export function isHlsPlaybackUrl(
  input: string,
  origin = 'https://hls.invalid'
) {
  try {
    const url = new URL(input, origin);
    return (
      url.pathname === AD_PROXY ||
      url.pathname === VOD_PROXY ||
      /\.m3u8?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/** Builds one playlist proxy while retaining transport proxying and signed URLs. */
export function buildHlsAdProxyUrl(
  input: string,
  options: {
    origin: string;
    source?: string;
    token?: string;
    adBlock?: boolean;
    proxySegments?: boolean;
    absolute?: boolean;
  }
) {
  try {
    const url = new URL(input, options.origin);
    if (!/^https?:$/.test(url.protocol)) return input;
    const isAdProxy =
      url.origin === new URL(options.origin).origin &&
      url.pathname === AD_PROXY;
    const isVodProxy =
      url.origin === new URL(options.origin).origin &&
      url.pathname === VOD_PROXY;
    if (
      url.origin === new URL(options.origin).origin &&
      !isAdProxy &&
      !isVodProxy
    )
      return options.absolute ? url.toString() : input;
    // A transport proxy is also useful for extensionless HLS URLs. Known files
    // such as MP4 must remain direct: playlist filtering cannot edit them.
    if (
      !isAdProxy &&
      !isVodProxy &&
      /\.(?:mp4|mkv|webm|flv|avi|mov|m4v|mp3|aac)(?:$)/i.test(url.pathname)
    )
      return input;
    const proxy = isAdProxy ? url : new URL(AD_PROXY, options.origin);
    const mediaUrl = isVodProxy ? url.searchParams.get('url') : url.href;
    if (!isAdProxy && mediaUrl) proxy.searchParams.set('url', mediaUrl);
    const source =
      options.source || (isVodProxy ? url.searchParams.get('source') : '');
    if (source) proxy.searchParams.set('source', source);
    if (options.token) proxy.searchParams.set('token', options.token);
    if (options.adBlock === false) proxy.searchParams.set('adblock', 'false');
    else proxy.searchParams.delete('adblock');
    if (isVodProxy || options.proxySegments)
      proxy.searchParams.set('proxySegments', 'true');
    return options.absolute
      ? proxy.toString()
      : `${proxy.pathname}${proxy.search}`;
  } catch {
    return input;
  }
}
