import { isM3u8SourceUrl as isTVBoxM3u8Url } from '@/lib/m3u8-source-filter';
export { isM3u8SourceUrl as isTVBoxM3u8Url } from '@/lib/m3u8-source-filter';
import { yellowWords } from '@/lib/yellow';

import { TVBOX_HLS_PATH, tvboxHlsUrl } from './hls';

function episodeUrl(episode: string) {
  const separator = episode.indexOf('$');
  const rest = separator >= 0 ? episode.slice(separator + 1) : episode;
  return rest.split('$')[0].trim();
}

export function proxyTVBoxHlsUrl(url: string, baseUrl: string, source = '') {
  const original = new URL(url);
  const ownOrigin = original.origin === new URL(baseUrl).origin;
  if (ownOrigin && original.pathname === TVBOX_HLS_PATH) return url;
  const params =
    ownOrigin && original.pathname === '/api/proxy-m3u8'
      ? new URLSearchParams(original.search)
      : new URLSearchParams({ url });
  if (source && !params.has('source')) params.set('source', source);
  const token = process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN;
  if (token && !params.has('token')) params.set('token', token);
  return tvboxHlsUrl(baseUrl, params);
}

export function proxyTVBoxPlayUrls(
  playUrl: string,
  playFrom: string,
  baseUrl: string,
  source = ''
): string {
  const playSources = playFrom.split('$$$');
  return playUrl
    .split('$$$')
    .map((line, index) =>
      line
        .split('#')
        .map((episode) => {
          const separator = episode.indexOf('$');
          const title = separator >= 0 ? episode.slice(0, separator + 1) : '';
          const rest = separator >= 0 ? episode.slice(separator + 1) : episode;
          const suffixIndex = rest.indexOf('$');
          const url = (
            suffixIndex >= 0 ? rest.slice(0, suffixIndex) : rest
          ).trim();
          const suffix = suffixIndex >= 0 ? rest.slice(suffixIndex) : '';
          if (!isTVBoxM3u8Url(url)) return episode;
          return (
            title +
            proxyTVBoxHlsUrl(url, baseUrl, source || playSources[index]) +
            suffix
          );
        })
        .join('#')
    )
    .join('$$$');
}

export function processTVBoxPlayLines(
  playUrl: string,
  playFrom: string,
  baseUrl: string,
  options: { source?: string; adFilter?: boolean; m3u8Only?: boolean } = {}
) {
  const names = playFrom.split('$$$');
  const lines = playUrl
    .split('$$$')
    .map((line, index) => ({
      url: options.m3u8Only
        ? line
            .split('#')
            .filter((episode) => isTVBoxM3u8Url(episodeUrl(episode)))
            .join('#')
        : line,
      name: names[index] || '',
    }))
    .filter((line) => !options.m3u8Only || line.url);
  const selectedNames = lines.map((line) => line.name).join('$$$');
  const selectedUrls = lines.map((line) => line.url).join('$$$');
  return {
    vod_play_url: options.adFilter
      ? proxyTVBoxPlayUrls(selectedUrls, selectedNames, baseUrl, options.source)
      : selectedUrls,
    vod_play_from: selectedNames,
  };
}

export function filterTVBoxCMS(
  input: unknown,
  baseUrl: string,
  adFilter: boolean,
  yellowFilter: boolean,
  source = '',
  m3u8Only = false
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const data = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  const restricted = (item: Record<string, unknown>) => {
    const text = ['vod_name', 'type_name', 'vod_remarks', 'vod_content']
      .map((key) => String(item[key] || ''))
      .join(' ')
      .toLowerCase();
    return yellowWords.some((word) => text.includes(word.toLowerCase()));
  };
  if (yellowFilter && Array.isArray(data.class))
    data.class = data.class.filter((item) => !restricted(item));
  if (Array.isArray(data.list)) {
    if (yellowFilter) data.list = data.list.filter((item) => !restricted(item));
    data.list = (data.list as Array<Record<string, unknown>>).flatMap(
      (item) => {
        if ((!adFilter && !m3u8Only) || typeof item.vod_play_url !== 'string')
          return [item];
        const lines = processTVBoxPlayLines(
          item.vod_play_url,
          String(item.vod_play_from || ''),
          baseUrl,
          { source, adFilter, m3u8Only }
        );
        if (m3u8Only && !lines.vod_play_url) return [];
        return [
          {
            ...item,
            ...lines,
          },
        ];
      }
    );
  }
  return data;
}
